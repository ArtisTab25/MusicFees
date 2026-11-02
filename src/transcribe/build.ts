// Del análisis a una canción de MusicFees: cuantiza las notas a la rejilla de tiempos (semicorcheas o
// tresillos, lo que mejor encaje en cada tiempo), digita las partes de cuerda, arma una pista por parte
// con su instrumento, y escribe tempo, compás, armadura, secciones, acordes con diagrama y avisos.
import * as at from "@coderline/alphatab";
import { applyOp, createSong, finishScore, type ClipBeat, type ClipNote, type Op, type SongAnalysis } from "../score/model";
import { pack } from "../score/structure";
import { clipTicks, restsFor } from "../score/clip";
import { presetById, TUNINGS } from "../score/instruments";
import { CHORDS, voicings } from "../score/chords";
import { beatPos } from "./analyze";
import { chooseTuning, fretEvents } from "./fretting";
import type { Analysis, Part, RawNote, Role, TranscribeOpts } from "./types";

type Score = at.model.Score;
const Q = 960;

export const ROLE_NAMES: Record<Role, string> = { vocals: "Voz", melody: "Melodía", guitar: "Guitarra", keys: "Teclado", harmony: "Acordes", bass: "Bajo", drums: "Batería", all: "Transcripción" };

/** Instrumento sugerido para cada parte (el usuario lo puede cambiar antes de crear la canción). */
export function suggestPreset(part: Part): string {
  if (part.role === "drums") return "drums";
  if (part.role === "bass") return "bass_finger";
  if (part.role === "vocals") return "voice";
  if (part.hint) return part.hint;
  // Rango real sin los extremos sueltos (un armónico mal leído no cambia el instrumento).
  const ps = part.notes.map((n) => n.p).sort((a, b) => a - b);
  const low = ps[Math.floor(ps.length * 0.03)] ?? 60, high = ps[Math.floor(ps.length * 0.97)] ?? 60;
  // Polifonía máxima: si pasa de 6 notas a la vez o baja de Mi grave, es de teclado.
  const ev = [...part.notes].sort((a, b) => a.s - b.s);
  let poly = 0;
  for (let i = 0; i < ev.length; i++) { let c = 1; for (let j = i + 1; j < ev.length && ev[j].s - ev[i].s < 0.04; j++) c++; poly = Math.max(poly, c); }
  if (part.role === "melody") return "gtr_clean"; // la melodía también sale en tablatura (se puede cambiar)
  if (poly > 6 || low < 38 || high - low > 48) return "piano";
  return part.role === "all" ? "gtr_steel" : "gtr_clean";
}

interface Ev { tick: number; end: number; pitches: number[]; amps: number[] }

/**
 * Rejilla por tiempo y por pista: corcheas (2), semicorcheas (4) o tresillos (3). Se elige la que
 * deja menos error con un pequeño costo por cada subdivisión más fina, así una pista de acordes no se
 * llena de semicorcheas por imprecisiones de milisegundos, pero un riff rápido sí las conserva.
 */
function gridPerBeat(qs: number[], nBeats: number, fineCost = 0.0025): number[] {
  const g = new Array(nBeats + 2).fill(2);
  const byBeat = new Map<number, number[]>();
  for (const q of qs) { const j = Math.floor(q); const f = q - j; (byBeat.get(j) ?? byBeat.set(j, []).get(j)!).push(f); }
  for (const [j, fs] of byBeat) {
    if (j < 0 || j >= g.length) continue;
    const cost = (div: number, pen: number) => fs.reduce((s, f) => { const d = (f * div - Math.round(f * div)) / div; return s + d * d + pen; }, 0);
    const c2 = cost(2, 0), c4 = cost(4, fineCost), c3 = cost(3, fineCost * 1.6);
    g[j] = c3 < c4 && c3 < c2 && fs.length >= 2 ? 3 : c4 < c2 ? 4 : 2;
  }
  return g;
}

function quantTick(q: number, grid: number[]): number {
  const j = Math.floor(q), g = grid[j] ?? 2;
  let sub = Math.round((q - j) * g), jj = j;
  if (sub >= g) { jj++; sub = 0; }
  return Math.max(0, jj * Q + sub * (Q / g));
}

/** Notas → eventos (acordes por ataque) en ticks. */
function toEvents(notes: RawNote[], q: (t: number) => number, grid: number[], drums: boolean): Ev[] {
  const map = new Map<number, Ev>();
  for (const n of notes) {
    const tick = quantTick(q(n.s), grid);
    let end = quantTick(q(n.e), grid);
    const step = Q / (grid[Math.floor(tick / Q)] ?? 2);
    if (drums) end = tick + Q; // un golpe dura hasta el siguiente (máx. un tiempo): corcheas legibles
    if (end <= tick) end = tick + step;
    const ev = map.get(tick) ?? { tick, end, pitches: [], amps: [] };
    if (!ev.pitches.includes(n.p)) { ev.pitches.push(n.p); ev.amps.push(n.a); }
    ev.end = Math.max(ev.end, end);
    map.set(tick, ev);
  }
  return [...map.values()].sort((a, b) => a.tick - b.tick);
}

/** Como splitTicks, pero sin doble puntillo (más fácil de leer en una transcripción). */
const SIMPLE: { dur: number; dots: number; ticks: number }[] = [];
for (const d of [1, 2, 4, 8, 16, 32]) for (const dots of [1, 0]) SIMPLE.push({ dur: d, dots, ticks: (3840 / d) * (dots ? 1.5 : 1) });
SIMPLE.sort((a, b) => b.ticks - a.ticks);
function splitSimple(ticks: number): { dur: number; dots: number }[] {
  const out: { dur: number; dots: number }[] = [];
  let left = ticks;
  while (left > 0.5) { const s = SIMPLE.find((x) => x.ticks <= left + 0.5); if (!s) break; out.push({ dur: s.dur, dots: s.dots }); left -= s.ticks; }
  return out;
}

/** Línea de tiempo (notas y silencios) → tiempos de MusicFees, partidos en los cambios de rejilla. */
function toClips(evs: Ev[], notesOf: (i: number) => ClipNote[], grid: number[], total: number, drums: boolean): ClipBeat[] {
  const out: ClipBeat[] = [];
  const emit = (start: number, end: number, notes: ClipNote[]) => {
    let cur = start, first = true;
    while (cur < end - 0.5) {
      const j = Math.floor(cur / Q);
      let stop: number;
      if (grid[j] === 3) stop = Math.min(end, (j + 1) * Q);
      else { let k = j; while ((k + 1) * Q < end && grid[k + 1] !== 3) k++; stop = Math.min(end, (k + 1) * Q); }
      const len = stop - cur;
      const pieces: { dur: number; dots: number; tup: number }[] = grid[j] === 3 && len % Q !== 0
        ? Array.from({ length: Math.round(len / 320) }, () => ({ dur: 8, dots: 0, tup: 3 }))
        : splitSimple(len).map((d) => ({ ...d, tup: 0 }));
      // Dos tresillos de corchea seguidos con las mismas notas = una negra de tresillo.
      if (grid[j] === 3 && pieces.length === 2 && cur % 320 === 0) pieces.splice(0, 2, { dur: 4, dots: 0, tup: 3 });
      for (const p of pieces) {
        const cont = !first;
        const ns = !notes.length ? [] : cont ? (drums ? [] : notes.map((n) => ({ ...n, fx: ["tie" as const] }))) : notes;
        out.push({ dur: p.dur, dots: p.dots, tup: p.tup, notes: ns });
        first = false;
      }
      cur = stop;
    }
  };
  let pos = 0;
  evs.forEach((ev, i) => {
    if (ev.tick > pos) emit(pos, ev.tick, []);
    const next = evs[i + 1]?.tick ?? Math.max(ev.end, total);
    const stop = Math.min(ev.end, next);
    emit(ev.tick, stop, notesOf(i));
    pos = stop;
  });
  if (pos < total) emit(pos, total, []);
  return out;
}

/** Resumen guardable del análisis (acordes por compás, secciones, contrapunto y avisos). */
export function summarize(a: Analysis, source: SongAnalysis["source"]): SongAnalysis {
  const off = a.downbeat > 0 ? a.downbeat - a.meter : 0;
  return {
    at: Date.now(), source, tempo: Math.round(a.tempo), meter: a.meter, key: a.key.name,
    chords: a.chords.filter((c) => c.root >= 0).map((c) => { const q = c.b0 - off; return [Math.floor(q / a.meter), ((q % a.meter) + a.meter) % a.meter, c.name, c.roman] as [number, number, string, string]; }),
    sections: a.sections, counterpoint: a.counterpoint?.summary ?? [], notes: a.notesForUser,
  };
}

/** Crea la canción a partir del análisis. Devuelve la partitura lista para abrirse. */
export function buildScore(a: Analysis, opts: TranscribeOpts): Score {
  const off = a.downbeat > 0 ? a.downbeat - a.meter : 0;
  const q = (t: number) => beatPos(a.beats, t) - off;
  const cap = a.meter * Q;
  const parts = a.parts.filter((p) => p.notes.length && (p.role !== "drums" || opts.drums));
  const nBeats = Math.ceil(Math.max(1, ...parts.flatMap((p) => p.notes.map((n) => q(n.e))))) + 1;
  const plan = parts.map((p) => {
    const presetId = opts.presets[p.role] ?? suggestPreset(p);
    const preset = presetById(presetId) ?? presetById("gtr_clean")!;
    // Rejilla propia de cada pista: los acordes pagan más por subdividir (se leen mejor en corcheas).
    const chordal = p.role === "harmony" || p.role === "guitar" || p.role === "keys" || p.role === "all";
    const grid = gridPerBeat(p.notes.map((n) => q(n.s)), nBeats, chordal ? 0.006 : p.role === "drums" ? 0.0015 : 0.003);
    const evs = toEvents(p.notes, q, grid, preset.kind === "drums");
    // Voz, melodía y bajo son una sola línea: una nota por ataque (la más aguda o la más grave).
    if (p.role === "melody" || p.role === "bass" || p.role === "vocals") for (const ev of evs) {
      const k = ev.pitches.indexOf(p.role === "melody" ? Math.max(...ev.pitches) : Math.min(...ev.pitches));
      ev.pitches = [ev.pitches[k]]; ev.amps = [ev.amps[k]];
    }
    return { part: p, preset, evs, grid };
  });
  const lastTick = Math.max(cap, ...plan.flatMap((x) => x.evs.map((e) => e.end)));
  const nBars = Math.max(1, Math.ceil(lastTick / cap));
  const total = nBars * cap;
  // Canción base y pistas
  const score = createSong("blank_gtr", nBars, opts.title || "Transcripción");
  const ops: Op[] = [];
  const tunings: (number[] | undefined)[] = [];
  const clipBars: ClipBeat[][][] = [];
  for (const x of plan) {
    let tuning: number[] | undefined;
    let notesOf: (i: number) => ClipNote[];
    if (x.preset.kind === "tab") {
      const evPitches = x.evs.map((e) => e.pitches.slice().sort((a, b) => b - a));
      tuning = x.preset.tuning;
      // Guitarras de 6: si hay notas más graves que el Mi, prueba Drop D, Re estándar y Drop C.
      if (tuning && tuning.length === 6 && tuning[5] === 40 && Math.min(...x.evs.flatMap((e) => e.pitches)) < 40)
        tuning = chooseTuning(evPitches, [TUNINGS.std, TUNINGS.dropD, TUNINGS.dStd, TUNINGS.dropC].map((t, i) => ({ id: String(i), strings: t.strings }))).strings;
      if (tuning && tuning.length === 4 && Math.min(...x.evs.flatMap((e) => e.pitches)) < tuning[3]) tuning = TUNINGS.bass5?.strings ?? tuning;
      const fr = fretEvents(evPitches, tuning ?? TUNINGS.std.strings, x.preset.id.startsWith("bass") ? 20 : 22);
      notesOf = (i) => fr.placed[i].map((n) => ({ pitch: n.pitch, str: n.str, fret: n.fret, fx: [] }));
    } else if (x.preset.kind === "drums") {
      notesOf = (i) => x.evs[i].pitches.map((p) => ({ drum: p, fx: [] }));
    } else {
      // Teclado: hasta 8 notas por acorde (las más fuertes).
      notesOf = (i) => x.evs[i].pitches.map((p, k) => ({ p, a: x.evs[i].amps[k] })).sort((m, n) => n.a - m.a).slice(0, 8).map((z) => ({ pitch: z.p, fx: [] }));
    }
    tunings.push(tuning);
    const clips = toClips(x.evs, notesOf, x.grid, total, x.preset.kind === "drums");
    const bars = pack(clips, () => cap, x.preset.kind === "drums");
    while (bars.length < nBars) bars.push(restsFor(cap));
    clipBars.push(bars.slice(0, nBars));
  }
  plan.forEach((x, i) => ops.push({ k: "trackAdd", preset: x.preset.id, name: ROLE_NAMES[x.part.role], tuning: tunings[i] }));
  ops.push({ k: "trackDel", t: 0 });
  ops.push({ k: "songProp", prop: "tempo", val: Math.round(a.tempo) });
  for (let b = 0; b < nBars; b++) {
    if (a.meter !== 4) ops.push({ k: "barProp", b, prop: "ts", val: `${a.meter}/4` });
    ops.push({ k: "barProp", b, prop: "key", val: a.key.sig });
  }
  clipBars.forEach((bars, t) => bars.forEach((beats, b) => ops.push({ k: "setVoice", t, b, v: 0, beats })));
  for (const s of a.sections) if (s.b0 < nBars) ops.push({ k: "barProp", b: s.b0, prop: "section", val: `${s.label}|${s.name}` });
  // Acordes: en todas las pistas con notas (se ven en la que estés viendo). Diagrama solo en guitarras
  // de 6 cuerdas en afinación estándar; en las demás, el nombre.
  plan.forEach((x, ct) => {
    if (x.preset.kind === "drums") return;
    const std = x.preset.kind === "tab" && (tunings[ct] ?? x.preset.tuning ?? []).join() === TUNINGS.std.strings.join();
    const defined = new Set<string>();
    let lastName = "";
    for (const c of a.chords) {
      if (c.root < 0 || c.name === lastName) continue;
      const tick = (c.b0 - off) * Q;
      const b = Math.floor(tick / cap), pos = tick - b * cap;
      const beats = clipBars[ct][b];
      if (!beats) continue;
      // El tiempo que empieza en el cambio (o el primero dentro de ese tiempo); si no, el que lo cubre.
      let acc = 0, idx = -1, cover = -1;
      for (let i = 0; i < beats.length; i++) {
        const len = clipTicks(beats[i]);
        if (acc >= pos - 0.5 && acc < pos + Q) { idx = i; break; }
        if (acc <= pos && acc + len > pos) cover = i;
        acc += len;
      }
      if (idx < 0) idx = cover;
      if (idx < 0) continue;
      lastName = c.name;
      if (!defined.has(c.name)) {
        const type = CHORDS.find((k) => k.k === (c.type === "m7b5" ? "m7♭5" : c.type));
        const v = std && type ? voicings(c.root, type)[0] : null;
        ops.push({ k: "chordDef", t: ct, id: c.name, name: c.name, frets: v ? v.frets : [], diagram: !!v });
        defined.add(c.name);
      }
      ops.push({ k: "beatFx", t: ct, b, v: 0, i: idx, fx: "chord", val: c.name });
    }
  });
  if (opts.markDoubtful) for (const b of a.doubtful.filter((x) => x >= 0 && x < nBars).slice(0, 40))
    ops.push({ k: "comment", c: { id: `tr-${b}`, b, text: "Revisar: notas dudosas en la transcripción.", by: "Transcriptor", at: Date.now() } });
  ops.push({ k: "analysis", a: summarize(a, "audio") });
  let s = score;
  for (const op of ops) s = applyOp(s, op);
  s.title = opts.title || "Transcripción";
  finishScore(s);
  return s;
}
