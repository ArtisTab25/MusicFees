// Obra completa: secciones con nombre (Intro, Verso, Coro…) que se navegan, se duplican, se mueven
// o se borran como bloques en todas las pistas; doble/mitad de tiempo; cambio de compás en un rango
// reacomodando las notas; y técnicas aplicadas a toda una selección. Todo se traduce a operaciones
// normales (barIns/barDel/barProp/setVoice/noteFx) para que deshacer y el dúo en vivo funcionen igual.
import * as at from "@coderline/alphatab";
import { barCapacity, beatToClip, kindOf, noteFxState, type ClipBeat, type NoteFx, type Op } from "./model";
import { clipTicks, eachSelected, ordered, restsFor, type Selection } from "./clip";

type Score = at.model.Score;

export interface SectionBlock { b: number; e: number; name: string; marker: string }

/** Bloques de la canción: cada marca de sección empieza uno. Lo anterior a la primera marca es «Inicio». */
export function sections(score: Score): SectionBlock[] {
  const out: SectionBlock[] = [];
  const mbs = score.masterBars;
  mbs.forEach((mb, b) => {
    if (mb.section || b === 0) {
      if (out.length) out[out.length - 1].e = b - 1;
      out.push({ b, e: mbs.length - 1, name: mb.section ? mb.section.text || mb.section.marker : "Inicio", marker: mb.section?.marker ?? "" });
    }
  });
  return out;
}
export const sectionAt = (score: Score, bar: number) => sections(score).find((s) => bar >= s.b && bar <= s.e) ?? null;

// ---------- copiar compases completos de toda la canción ----------
interface BarCopy { props: Op[]; voices: ClipBeat[][][] /* [pista][voz] → tiempos */ }
const PROPS = ["ts", "section", "repeatOpen", "repeatClose", "doubleBar", "alternate"] as const;

function propsOf(mb: at.model.MasterBar, b: number): Op[] {
  const sec = mb.section ? `${mb.section.marker}|${mb.section.text}` : null;
  const val: Record<(typeof PROPS)[number], number | string | boolean | null> = {
    ts: `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`, section: sec, repeatOpen: mb.isRepeatStart,
    repeatClose: mb.repeatCount, doubleBar: mb.isDoubleBar, alternate: mb.alternateEndings,
  };
  return PROPS.map((prop) => ({ k: "barProp", b, prop, val: val[prop] }) as Op);
}
function copyBars(score: Score, s: number, e: number): BarCopy[] {
  const out: BarCopy[] = [];
  for (let b = s; b <= e; b++) {
    out.push({
      props: propsOf(score.masterBars[b], 0),
      voices: score.tracks.map((tr) => (tr.staves[0].bars[b]?.voices ?? []).map((v) => v.beats.map((x) => beatToClip(tr, x)))),
    });
  }
  return out;
}
/** Inserta compases copiados en la posición `at` (todo lo que seguía se recorre). */
function insertCopies(copies: BarCopy[], at0: number): Op[] {
  const ops: Op[] = [];
  copies.forEach((_, j) => ops.push({ k: "barIns", at: at0 + j }));
  copies.forEach((c, j) => {
    for (const p of c.props) ops.push({ ...(p as Extract<Op, { k: "barProp" }>), b: at0 + j });
    c.voices.forEach((vs, t) => vs.forEach((beats, v) => ops.push({ k: "setVoice", t, b: at0 + j, v, beats })));
  });
  return ops;
}

/** Duplica una sección justo después de ella (en todas las pistas). */
export function planDupSection(score: Score, s: number, e: number): Op[] {
  return insertCopies(copyBars(score, s, e), e + 1);
}
/** Mueve los compases s..e para que empiecen donde ahora está el compás `to` (antes de él). */
export function planMoveBars(score: Score, s: number, e: number, to: number): { ops: Op[]; at: number } | null {
  if (to >= s && to <= e + 1) return null;
  const copies = copyBars(score, s, e);
  const n = e - s + 1;
  const ops: Op[] = [];
  for (let b = e; b >= s; b--) ops.push({ k: "barDel", at: b });
  const dest = to > e ? to - n : to;
  ops.push(...insertCopies(copies, dest));
  return { ops, at: dest };
}
/** Borra una sección completa. */
export function planDeleteSection(score: Score, s: number, e: number): Op[] {
  const ops: Op[] = [];
  for (let b = e; b >= s; b--) ops.push({ k: "barDel", at: b });
  if (score.masterBars.length - (e - s + 1) < 1) ops.push({ k: "barIns", at: 0 });
  return ops;
}

// ---------- reacomodar tiempos en compases ----------
/** Duraciones estándar (con 0–2 puntillos) de mayor a menor, para partir notas largas. */
const STD: { dur: number; dots: number; ticks: number }[] = [];
for (const d of [1, 2, 4, 8, 16, 32, 64]) for (const dots of [2, 1, 0]) {
  let t = 3840 / d, add = t / 2;
  for (let i = 0; i < dots; i++) { t += add; add /= 2; }
  STD.push({ dur: d, dots, ticks: t });
}
STD.sort((a, b) => b.ticks - a.ticks);
/** Parte `ticks` en duraciones escribibles (la mayor que quepa primero). */
export function splitTicks(ticks: number): { dur: number; dots: number }[] {
  const out: { dur: number; dots: number }[] = [];
  let left = ticks;
  while (left > 0.5) {
    const s = STD.find((x) => x.ticks <= left + 0.5);
    if (!s) break;
    out.push({ dur: s.dur, dots: s.dots }); left -= s.ticks;
  }
  return out;
}
/** Pedazos de un tiempo partido: el primero conserva sus efectos, los demás quedan ligados. */
function pieces(cb: ClipBeat, ticks: number, first: boolean, drums: boolean): ClipBeat[] {
  return splitTicks(ticks).map((d, k) => {
    const cont = !first || k > 0;
    if (cont && (drums || !cb.notes.length)) return { dur: d.dur, dots: d.dots, tup: 0, notes: [] };
    return {
      ...cb, dur: d.dur, dots: d.dots, tup: 0,
      text: cont ? null : cb.text,
      notes: cont ? cb.notes.map((n) => ({ ...n, bend: undefined, fx: ["tie" as NoteFx, ...n.fx.filter((f) => f === "palmMute" || f === "letRing" || f === "vibrato")] })) : cb.notes,
    };
  });
}
/**
 * Reparte una lista de tiempos en compases de las capacidades dadas. Lo que cruza la barra de compás
 * se parte y se liga; los tresillos que no caben pasan enteros al compás siguiente.
 */
export function pack(beats: ClipBeat[], caps: (bar: number) => number, drums = false): ClipBeat[][] {
  const bars: ClipBeat[][] = [[]];
  let pos = 0, bar = 0;
  const next = () => { bars.push([]); bar++; pos = 0; };
  for (const cb of beats) {
    let left = clipTicks(cb), first = true;
    while (left > 0.5) {
      const space = caps(bar) - pos;
      if (space <= 0.5) { next(); continue; }
      if (left <= space + 0.5) {
        if (first) bars[bar].push(cb);
        else bars[bar].push(...pieces(cb, left, false, drums));
        pos += left; left = 0;
      } else if (cb.tup > 1) {
        bars[bar].push(...restsFor(space)); next();
      } else {
        bars[bar].push(...pieces(cb, space, first, drums));
        first = false; left -= space; next();
      }
    }
  }
  // El último compás se completa con silencios; los compases vacíos al final se quitan.
  while (bars.length > 1 && !bars[bars.length - 1].length) bars.pop();
  const lastUsed = bars[bars.length - 1].reduce((n, x) => n + clipTicks(x), 0);
  bars[bars.length - 1].push(...restsFor(Math.max(0, caps(bars.length - 1) - lastUsed)));
  return bars;
}
/** Quita los silencios del final (para no arrastrar compases vacíos al reacomodar). */
function trimRests(beats: ClipBeat[]): ClipBeat[] {
  let n = beats.length;
  while (n > 0 && !beats[n - 1].notes.length) n--;
  return beats.slice(0, n);
}

/**
 * Cambia la métrica de los compases s..e y reacomoda lo escrito en todas las pistas.
 * Si las notas ocupan más o menos compases, se agregan o se quitan compases en ese punto.
 */
export function planChangeMeter(score: Score, s: number, e: number, ts: string): { ops: Op[]; bars: number } | null {
  const [num, den] = ts.split("/").map(Number);
  if (!(num > 0) || ![1, 2, 4, 8, 16, 32].includes(den)) return null;
  const cap = (num * 3840) / den;
  const n = e - s + 1;
  // Contenido de cada pista/voz en el rango, como una sola tira de tiempos.
  const flows = score.tracks.map((tr) => {
    const nv = Math.max(...Array.from({ length: n }, (_, j) => tr.staves[0].bars[s + j]?.voices.length ?? 1));
    return Array.from({ length: nv }, (_, v) => {
      const flat: ClipBeat[] = [];
      for (let b = s; b <= e; b++) {
        const voice = tr.staves[0].bars[b]?.voices[v];
        const mbCap = barCapacity(score.masterBars[b]);
        if (!voice || voice.isEmpty || !voice.beats.length) { flat.push(...restsFor(mbCap)); continue; }
        flat.push(...voice.beats.map((x) => beatToClip(tr, x)));
      }
      return { drums: kindOf(tr) === "drums", beats: flat };
    });
  });
  const packed = flows.map((vs) => vs.map((f) => pack(trimRests(f.beats), () => cap, f.drums)));
  const m = Math.max(1, ...packed.flatMap((vs) => vs.map((bars) => bars.length)));
  const ops: Op[] = [];
  if (m > n) for (let j = 0; j < m - n; j++) ops.push({ k: "barIns", at: e + 1 });
  if (m < n) for (let b = e; b >= s + m; b--) ops.push({ k: "barDel", at: b });
  for (let j = 0; j < m; j++) ops.push({ k: "barProp", b: s + j, prop: "ts", val: ts });
  packed.forEach((vs, t) => vs.forEach((bars, v) => {
    for (let j = 0; j < m; j++) ops.push({ k: "setVoice", t, b: s + j, v, beats: bars[j] ?? restsFor(cap) });
  }));
  return { ops, bars: m };
}

/**
 * Doble tiempo (`factor` 0.5: todo dura la mitad) o mitad de tiempo (`factor` 2: todo dura el doble)
 * en los compases s..e. Con `all` cambia todas las pistas; si no, solo la pista `t`.
 * Mitad de tiempo agrega compases después del rango (en toda la canción) para que quepa lo escrito;
 * doble tiempo deja silencio al final (o quita los compases sobrantes si son todas las pistas).
 */
export function planScaleTime(score: Score, t: number, s: number, e: number, factor: 0.5 | 2, all: boolean): { ops: Op[]; lost: number } {
  const n = e - s + 1;
  let lost = 0;
  const scale = (cb: ClipBeat): ClipBeat[] => {
    if (factor === 0.5) {
      if (cb.dur >= 64) { lost++; return [cb]; }
      return [{ ...cb, dur: cb.dur * 2 }];
    }
    if (cb.dur > 1) return [{ ...cb, dur: cb.dur / 2 }];
    // Una redonda a mitad de tiempo dura dos redondas: se parte y se liga.
    return pieces(cb, clipTicks(cb) * 2, true, false);
  };
  const tracks = all ? score.tracks.map((_, i) => i) : [t];
  const capOf = (b: number) => barCapacity(score.masterBars[Math.min(b, score.masterBars.length - 1)]);
  const packedBy = tracks.map((ti) => {
    const tr = score.tracks[ti];
    const nv = tr.staves[0].bars[s]?.voices.length ?? 1;
    return Array.from({ length: nv }, (_, v) => {
      const flat: ClipBeat[] = [];
      for (let b = s; b <= e; b++) {
        const voice = tr.staves[0].bars[b]?.voices[v];
        if (!voice || voice.isEmpty) { flat.push(...restsFor(capOf(b)).flatMap(scale)); continue; }
        for (const x of voice.beats) flat.push(...scale(beatToClip(tr, x)));
      }
      return pack(factor === 2 ? flat : trimRests(flat), (j) => capOf(s + Math.min(j, n - 1)), kindOf(tr) === "drums");
    });
  });
  const need = factor === 2 ? 2 * n : n;
  const ops: Op[] = [];
  const extra = Math.max(0, Math.max(...packedBy.flatMap((vs) => vs.map((b) => b.length))) - n);
  const add = factor === 2 ? Math.min(extra, need - n) : 0;
  for (let j = 0; j < add; j++) ops.push({ k: "barIns", at: e + 1 });
  const total = n + add;
  // Doble tiempo en todas las pistas: los compases que quedan vacíos se quitan.
  let keep = total;
  if (factor === 0.5 && all) {
    keep = Math.max(1, ...packedBy.flatMap((vs) => vs.map((b) => b.length)));
    for (let b = s + total - 1; b >= s + keep; b--) ops.push({ k: "barDel", at: b });
  }
  packedBy.forEach((vs, k) => vs.forEach((bars, v) => {
    for (let j = 0; j < keep; j++) ops.push({ k: "setVoice", t: tracks[k], b: s + j, v, beats: bars[j] ?? restsFor(capOf(s + Math.min(j, n - 1))) });
  }));
  return { ops, lost };
}

/** Aplica (o quita, si ya todas la tenían) una técnica a todas las notas de la selección. */
export function planFxOnSelection(score: Score, sel: Selection, fx: NoteFx): { ops: Op[]; notes: number; on: boolean } {
  const tracks = sel.all ? score.tracks.map((_, i) => i) : [sel.t];
  const found: { t: number; v: number; b: number; i: number; n: at.model.Note; kind: string }[] = [];
  for (const t of tracks) {
    const tr = score.tracks[t];
    const kind = kindOf(tr);
    const voices = sel.all ? (tr.staves[0].bars[0]?.voices.length ?? 1) : 1;
    for (let v = 0; v < voices; v++) {
      const s2: Selection = sel.all ? { ...sel, all: false, t, v } : sel;
      eachSelected(score, s2, (b, i, beat) => { for (const n of beat.notes) found.push({ t, v: s2.v, b, i, n, kind }); });
    }
  }
  const on = !found.every((x) => noteFxState(x.n, fx));
  const ops: Op[] = found.map((x) => ({
    k: "noteFx", t: x.t, b: x.b, v: x.v, i: x.i, fx, on,
    ...(x.kind === "tab" ? { str: x.n.string } : x.kind === "drums" ? { art: x.n.percussionArticulation } : { pitch: x.n.realValue }),
  }) as Op);
  return { ops, notes: found.length, on };
}
/** Compases s..e de una selección (o el del cursor). */
export const selRange = (sel: Selection) => { const { s, e } = ordered(sel); return { s: s.b, e: e.b }; };
