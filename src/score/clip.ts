// Selección, portapapeles y transposición. Todo se traduce a operaciones `setVoice`
// (una por compás tocado), así el dúo en vivo recibe el resultado exacto y deshacer funciona igual.
import * as at from "@coderline/alphatab";
import { barCapacity, beatToClip, beatTicks, kindOf, type ClipBeat, type ClipNote, type Op } from "./model";

type Score = at.model.Score;

export interface Pos { b: number; i: number }
export interface Selection { t: number; v: number; a: Pos; z: Pos; /** Compases completos en todas las pistas. */ all?: boolean }
export interface Clip {
  /** Compases tal como se copiaron (cada uno con sus tiempos). */
  bars: ClipBeat[][];
  /** true si la selección cubría compases completos: se pega compás por compás. */
  whole: boolean;
  from: string; // nombre de la pista de origen, para los avisos
  kind: "tab" | "notation" | "drums";
  /** Copia de compases de toda la canción: [pista][compás][voz] → tiempos. */
  tracks?: ClipBeat[][][][];
}

const before = (p: Pos, q: Pos) => p.b < q.b || (p.b === q.b && p.i <= q.i);
export function ordered(sel: Selection): { s: Pos; e: Pos } {
  return before(sel.a, sel.z) ? { s: sel.a, e: sel.z } : { s: sel.z, e: sel.a };
}
const voiceOf = (score: Score, t: number, b: number, v: number) => score.tracks[t]?.staves[0]?.bars[b]?.voices[v] ?? null;

/** Recorre los tiempos seleccionados, compás por compás. */
export function eachSelected(score: Score, sel: Selection, fn: (b: number, i: number, beat: at.model.Beat) => void) {
  const { s, e } = ordered(sel);
  for (let b = s.b; b <= e.b; b++) {
    const voice = voiceOf(score, sel.t, b, sel.v);
    if (!voice) continue;
    const from = b === s.b ? s.i : 0, to = b === e.b ? Math.min(e.i, voice.beats.length - 1) : voice.beats.length - 1;
    for (let i = from; i <= to; i++) fn(b, i, voice.beats[i]);
  }
}
export function isWholeBars(score: Score, sel: Selection) {
  const { s, e } = ordered(sel);
  const last = voiceOf(score, sel.t, e.b, sel.v);
  return s.i === 0 && !!last && e.i >= last.beats.length - 1;
}
export function countSelected(score: Score, sel: Selection) { let n = 0; eachSelected(score, sel, () => n++); return n; }

export function copy(score: Score, sel: Selection): Clip {
  const tr = score.tracks[sel.t];
  if (sel.all) {
    const { s, e } = ordered(sel);
    const tracks = score.tracks.map((t) => {
      const out: ClipBeat[][][] = [];
      for (let b = s.b; b <= e.b; b++) out.push((t.staves[0].bars[b]?.voices ?? []).map((v) => v.beats.map((x) => beatToClip(t, x))));
      return out;
    });
    return { bars: tracks[sel.t] ? tracks[sel.t].map((vs) => vs[0] ?? []) : [], whole: true, from: "todas las pistas", kind: kindOf(tr), tracks };
  }
  const bars: ClipBeat[][] = [];
  let lastB = -1;
  eachSelected(score, sel, (b, _i, beat) => {
    if (b !== lastB) { bars.push([]); lastB = b; }
    bars[bars.length - 1].push(beatToClip(tr, beat));
  });
  return { bars, whole: isWholeBars(score, sel), from: tr.name, kind: kindOf(tr) };
}

// ---------- duraciones ----------
export function clipTicks(cb: ClipBeat) {
  let t = 3840 / cb.dur, add = t / 2;
  for (let i = 0; i < cb.dots; i++) { t += add; add /= 2; }
  if (cb.tup > 1) t = (t * (cb.tup === 3 ? 2 : 4)) / cb.tup;
  return t;
}
/** Silencios que llenan `ticks` (de mayor a menor). */
export function restsFor(ticks: number): ClipBeat[] {
  const out: ClipBeat[] = [];
  let left = ticks;
  for (const d of [1, 2, 4, 8, 16, 32, 64]) {
    const t = 3840 / d;
    while (left >= t - 0.5) { out.push({ dur: d, dots: 0, tup: 0, notes: [] }); left -= t; }
  }
  return out;
}
const rest = (cb: ClipBeat): ClipBeat => ({ ...cb, notes: [], text: null });

// ---------- pegar ----------
/**
 * Pega en la pista/voz destino a partir de un tiempo.
 * - Compases completos: reemplaza un compás por cada compás copiado (agrega compases al final si faltan).
 * - Tiempos sueltos: sobrescribe por duración desde el cursor; si un tiempo no cabe en el compás,
 *   pasa al siguiente y rellena el hueco con silencios. Lo que quedaba después se conserva.
 */
export function planPaste(score: Score, t: number, v: number, at0: Pos, clip: Clip, insert = false): Op[] {
  const ops: Op[] = [];
  const tr = score.tracks[t];
  let nBars = tr.staves[0].bars.length;
  const ensureBar = (b: number) => { while (b >= nBars) { ops.push({ k: "barIns", at: nBars }); nBars++; } };
  // Insertar: abre compases vacíos en el cursor y pega ahí (lo que seguía se recorre).
  if (insert && clip.whole) for (let j = 0; j < clip.bars.length; j++) { ops.push({ k: "barIns", at: at0.b }); nBars++; }
  if (clip.tracks) {
    clip.tracks.forEach((bars, ti) => {
      if (ti >= score.tracks.length) return;
      bars.forEach((voices, j) => { ensureBar(at0.b + j); voices.forEach((beats, vi) => ops.push({ k: "setVoice", t: ti, b: at0.b + j, v: vi, beats })); });
    });
    return ops;
  }
  if (clip.whole) {
    clip.bars.forEach((beats, j) => { ensureBar(at0.b + j); ops.push({ k: "setVoice", t, b: at0.b + j, v, beats }); });
    return ops;
  }
  const flat = clip.bars.flat();
  const capOf = (b: number) => barCapacity(score.masterBars[Math.min(b, score.masterBars.length - 1)]);
  let b = at0.b;
  const startVoice = voiceOf(score, t, b, v);
  let cur: ClipBeat[] = startVoice ? startVoice.beats.slice(0, at0.i).map((x) => beatToClip(tr, x)) : [];
  let pos = cur.reduce((n, x) => n + clipTicks(x), 0);
  for (const cb of flat) {
    const tk = clipTicks(cb);
    if (pos + tk > capOf(b) + 0.5 && cur.length) {
      cur.push(...restsFor(capOf(b) - pos));
      ensureBar(b);
      ops.push({ k: "setVoice", t, b, v, beats: cur });
      b++; cur = []; pos = 0;
    }
    cur.push(cb); pos += tk;
  }
  // Cola: se conservan los tiempos originales que empiezan donde terminó lo pegado.
  ensureBar(b);
  const orig = voiceOf(score, t, b, v);
  let tick = 0, tail: ClipBeat[] = [], tailStart = capOf(b);
  if (orig) for (const x of orig.beats) {
    if (tick >= pos - 0.5) { tail = orig.beats.slice(x.index).map((y) => beatToClip(tr, y)); tailStart = tick; break; }
    tick += beatTicks(x);
  }
  cur.push(...restsFor(Math.max(0, tailStart - pos)), ...tail);
  ops.push({ k: "setVoice", t, b, v, beats: cur });
  return ops;
}

// ---------- reescribir la selección en su lugar (vaciar, transponer) ----------
function rewrite(score: Score, sel: Selection, change: (cb: ClipBeat) => ClipBeat): Op[] {
  const tr = score.tracks[sel.t];
  const { s, e } = ordered(sel);
  const ops: Op[] = [];
  for (let b = s.b; b <= e.b; b++) {
    const voice = voiceOf(score, sel.t, b, sel.v);
    if (!voice) continue;
    const from = b === s.b ? s.i : 0, to = b === e.b ? e.i : voice.beats.length - 1;
    ops.push({ k: "setVoice", t: sel.t, b, v: sel.v, beats: voice.beats.map((x, i) => (i >= from && i <= to ? change(beatToClip(tr, x)) : beatToClip(tr, x))) });
  }
  return ops;
}
/** Borra los compases seleccionados de toda la canción. */
export function planDeleteBars(score: Score, sel: Selection): Op[] {
  const { s, e } = ordered(sel);
  const ops: Op[] = [];
  const keep = score.masterBars.length - (e.b - s.b + 1);
  for (let b = e.b; b >= s.b; b--) ops.push({ k: "barDel", at: b });
  if (keep < 1) ops.push({ k: "barIns", at: 0 }); // la canción nunca queda sin compases
  return ops;
}
/** Deja los tiempos seleccionados como silencios (conserva el ritmo). */
export function planClear(score: Score, sel: Selection): Op[] {
  if (!sel.all) return rewrite(score, sel, rest);
  return score.tracks.flatMap((_, t) => score.tracks[t].staves[0].bars[0].voices.flatMap((__, v) => rewrite(score, { ...sel, all: false, t, v }, rest)));
}

/** Transpone semitonos. En tablatura reacomoda la nota en otra cuerda si se sale del diapasón. */
export function planTranspose(score: Score, sel: Selection, semis: number): { ops: Op[]; lost: number } {
  let lost = 0;
  const tr = score.tracks[sel.t];
  const tuning = tr.staves[0].tuning;
  const lo = kindOf(tr) === "tab" ? Math.min(...tuning) : 0, hi = kindOf(tr) === "tab" ? Math.max(...tuning) + 24 : 127;
  const ops = rewrite(score, sel, (cb) => ({
    ...cb,
    notes: cb.notes.flatMap((n): ClipNote[] => {
      if (n.pitch == null) return [n];
      const p = n.pitch + semis;
      if (p < lo || p > hi) { lost++; return []; }
      return [{ ...n, pitch: p, fret: n.fret != null ? n.fret + semis : undefined }];
    }),
  }));
  return { ops, lost };
}

// ---------- portapapeles persistente (sirve para pasar partes entre canciones) ----------
const KEY = "mf:clip";
let memory: Clip | null = null;
export function saveClip(c: Clip) { memory = c; try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* sin espacio */ } }
export function loadClip(): Clip | null {
  if (memory) return memory;
  try { const s = localStorage.getItem(KEY); memory = s ? (JSON.parse(s) as Clip) : null; } catch { memory = null; }
  return memory;
}
