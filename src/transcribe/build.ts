// Del análisis a una canción de MusicFees: cuantiza las notas a la rejilla de tiempos (semicorcheas o
// tresillos, lo que mejor encaje en cada tiempo), digita las partes de cuerda, arma una pista por parte
// con su instrumento, y escribe tempo, compás, armadura, secciones, acordes con diagrama y avisos.
import * as at from "@coderline/alphatab";
import { applyOp, createSong, finishScore, type ClipBeat, type ClipNote, type Op, type SongAnalysis } from "../score/model";
import { pack, splitTicks } from "../score/structure";
import { clipTicks, restsFor } from "../score/clip";
import { presetById, TUNINGS } from "../score/instruments";
import { CHORDS, voicings } from "../score/chords";
import { beatPos } from "./analyze";
import { chooseTuning, fretEvents } from "./fretting";
import type { Analysis, Part, RawNote, Role, TranscribeOpts } from "./types";

type Score = at.model.Score;
const Q = 960;

export const ROLE_NAMES: Record<Role, string> = { melody: "Melodía", harmony: "Acordes", bass: "Bajo", drums: "Batería", all: "Transcripción" };

/** Instrumento sugerido para cada parte (el usuario lo puede cambiar antes de crear la canción). */
export function suggestPreset(part: Part): string {
  if (part.role === "drums") return "drums";
  if (part.role === "bass") return "bass_finger";
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

/** Rejilla por tiempo: 4 (semicorcheas) o 3 (tresillos de corchea), la que menos error deja. */
function gridPerBeat(qs: number[], nBeats: number): number[] {
  const g = new Array(nBeats + 2).fill(4);
  const byBeat = new Map<number, number[]>();
  for (const q of qs) { const j = Math.floor(q); const f = q - j; (byBeat.get(j) ?? byBeat.set(j, []).get(j)!).push(f); }
  for (const [j, fs] of byBeat) {
    const err = (div: number) => fs.reduce((s, f) => { const d = f * div - Math.round(f * div); return s + d * d; }, 0) / div / div;
    // Tresillo solo si mejora claramente y hay al menos dos ataques que lo usan.
    const e4 = err(4), e3 = err(3);
    const usesTriplet = fs.filter((f) => Math.abs(f * 3 - Math.round(f * 3)) < 0.12 && Math.round(f * 3) % 3 !== 0).length;
    if (j >= 0 && j < g.length && e3 < e4 * 0.5 && usesTriplet >= 2) g[j] = 3;
  }
  return g;
}

function quantTick(q: number, grid: number[], coarse = false): number {
  const j = Math.floor(q), g0 = grid[j] ?? 4, g = coarse && g0 === 4 ? 2 : g0;
  let sub = Math.round((q - j) * g), jj = j;
  if (sub >= g) { jj++; sub = 0; }
  return Math.max(0, jj * Q + sub * (Q / g));
}

/** Notas → eventos (acordes por ataque) en ticks. */
function toEvents(notes: RawNote[], q: (t: number) => number, grid: number[], drums: boolean, coarse = false): Ev[] {
  const map = new Map<number, Ev>();
  for (const n of notes) {
    const tick = quantTick(q(n.s), grid, coarse);
    let end = quantTick(q(n.e), grid, coarse);
    const g = grid[Math.floor(tick / Q)] ?? 4;
    const step = Q / (coarse && g === 4 ? 2 : g);
    if (drums) end = tick + Q; // un golpe dura hasta el siguiente (máx. un tiempo): corcheas legibles
    if (end <= tick) end = tick + step;
    const ev = map.get(tick) ?? { tick, end, pitches: [], amps: [] };
    if (!ev.pitches.includes(n.p)) { ev.pitches.push(n.p); ev.amps.push(n.a); }
    ev.end = Math.max(ev.end, end);
    map.set(tick, ev);
  }
  return [...map.values()].sort((a, b) => a.tick - b.tick);
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
        : splitTicks(len).map((d) => ({ ...d, tup: 0 }));
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
  const allQ = parts.flatMap((p) => p.notes.map((n) => q(n.s)));
  const nBeats = Math.ceil(Math.max(1, ...parts.flatMap((p) => p.notes.map((n) => q(n.e))))) + 1;
  const grid = gridPerBeat(allQ, nBeats);
  const plan = parts.map((p) => {
    const presetId = opts.presets[p.role] ?? suggestPreset(p);
    const preset = presetById(presetId) ?? presetById("gtr_clean")!;
    // Los acordes se leen mejor en corcheas: los ataques sueltos de un mismo rasgueo se juntan.
    const evs = toEvents(p.notes, q, grid, preset.kind === "drums", p.role === "harmony");
    // Melodía y bajo son una sola línea: una nota por ataque (la más aguda o la más grave).
    if (p.role === "melody" || p.role === "bass") for (const ev of evs) {
      const k = ev.pitches.indexOf(p.role === "melody" ? Math.max(...ev.pitches) : Math.min(...ev.pitches));
      ev.pitches = [ev.pitches[k]]; ev.amps = [ev.amps[k]];
    }
    return { part: p, preset, evs };
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
    const clips = toClips(x.evs, notesOf, grid, total, x.preset.kind === "drums");
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
  // Acordes: con diagrama en la guitarra de acordes (afinación estándar); en otro caso, como texto.
  const ct = plan.findIndex((x) => x.part.role === "harmony" || x.part.role === "all");
  if (ct >= 0) {
    const x = plan[ct];
    const std = x.preset.kind === "tab" && (tunings[ct] ?? x.preset.tuning ?? []).join() === TUNINGS.std.strings.join();
    const defined = new Set<string>();
    let lastName = "";
    for (const c of a.chords) {
      if (c.root < 0 || c.name === lastName) continue;
      const tick = (c.b0 - off) * Q;
      const b = Math.floor(tick / cap), pos = tick - b * cap;
      const beats = clipBars[ct][b];
      if (!beats) continue;
      let acc = 0, idx = -1;
      for (let i = 0; i < beats.length; i++) {
        if (acc >= pos - 0.5 && acc < pos + Q && beats[i].notes.length && !beats[i].notes.every((n) => n.fx.includes("tie"))) { idx = i; break; }
        acc += clipTicks(beats[i]);
      }
      if (idx < 0) continue;
      lastName = c.name;
      if (std) {
        const type = CHORDS.find((k) => k.k === (c.type === "m7b5" ? "m7♭5" : c.type));
        const v = type ? voicings(c.root, type)[0] : null;
        if (v && !defined.has(c.name)) { ops.push({ k: "chordDef", t: ct, id: c.name, name: c.name, frets: v.frets }); defined.add(c.name); }
        if (v) { ops.push({ k: "beatFx", t: ct, b, v: 0, i: idx, fx: "chord", val: c.name }); continue; }
      }
      ops.push({ k: "beatFx", t: ct, b, v: 0, i: idx, fx: "text", val: c.name });
    }
  }
  if (opts.markDoubtful) for (const b of a.doubtful.filter((x) => x >= 0 && x < nBars).slice(0, 40))
    ops.push({ k: "comment", c: { id: `tr-${b}`, b, text: "Revisar: notas dudosas en la transcripción.", by: "Transcriptor", at: Date.now() } });
  ops.push({ k: "analysis", a: summarize(a, "audio") });
  let s = score;
  for (const op of ops) s = applyOp(s, op);
  s.title = opts.title || "Transcripción";
  finishScore(s);
  return s;
}
