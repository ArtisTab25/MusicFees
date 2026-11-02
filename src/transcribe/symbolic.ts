// Análisis de una partitura de MusicFees (sin audio): tonalidad, acordes con grados, estructura y
// contrapunto entre la voz más aguda y la más grave. Sirve para entender cómo está hecha una canción
// (por ejemplo, tus propias pistas de Guitar Pro) y para escribirle acordes y secciones.
import * as at from "@coderline/alphatab";
import { barCapacity, beatTicks, kindOf } from "../score/model";
import { sections as scoreSections } from "../score/structure";
import { analyzeNotes } from "./analyze";
import { analyzeCounterpoint, type VNote } from "./counterpoint";
import type { Analysis, RawNote } from "./types";

type Score = at.model.Score;

/** Notas reales (altura MIDI) de cada pista, con tiempos en negras desde el inicio. */
export function scoreNotes(score: Score): { t: number; name: string; drums: boolean; notes: RawNote[] }[] {
  const starts: number[] = [];
  let acc = 0;
  for (const mb of score.masterBars) { starts.push(acc); acc += barCapacity(mb); }
  return score.tracks.map((tr) => {
    const drums = kindOf(tr) === "drums";
    const notes: RawNote[] = [];
    const open = new Map<number, RawNote>(); // ligaduras: la nota sigue sonando
    tr.staves[0].bars.forEach((bar, b) => {
      for (const v of bar.voices) {
        let pos = starts[b] ?? 0;
        for (const beat of v.beats) {
          const len = beatTicks(beat);
          if (!beat.isEmpty) for (const n of beat.notes) {
            const p = drums ? (tr.percussionArticulations[n.percussionArticulation]?.outputMidiNumber ?? 38) : n.realValue;
            const s = pos / 960, e = (pos + len) / 960;
            const prev = open.get(p);
            if (n.isTieDestination && prev) { prev.e = e; continue; }
            const rn = { s, e, p, a: 0.4 + 0.08 * Math.max(0, (n.dynamics as number) ?? 5) };
            notes.push(rn); open.set(p, rn);
          }
          pos += len;
        }
      }
    });
    return { t: tr.index, name: tr.name, drums, notes };
  });
}

/** Análisis de la canción abierta. `upper`/`lower`: pistas para el contrapunto (por omisión, automáticas). */
export function analyzeScore(score: Score, upper?: number, lower?: number): Analysis & { voices: { upper: number; lower: number } } {
  const tracks = scoreNotes(score);
  const pitched = tracks.filter((t) => !t.drums && t.notes.length);
  const all = pitched.flatMap((t) => t.notes);
  const totalQ = score.masterBars.reduce((s, mb) => s + barCapacity(mb) / 960, 0);
  const beats = Array.from({ length: Math.max(2, Math.ceil(totalQ)) }, (_, i) => i);
  const ts = score.masterBars.map((mb) => barCapacity(mb) / 960);
  const common = ts.sort((a, b) => ts.filter((x) => x === b).length - ts.filter((x) => x === a).length)[0] ?? 4;
  const meter: 3 | 4 = Math.round(common) === 3 ? 3 : 4;
  const a = analyzeNotes({ notes: all, beats, duration: totalQ, tempo: score.tempo || 120, mode: "solo", meter, downbeat: 0 });
  // Si la canción ya tiene sus secciones marcadas (Guitar Pro las trae), se respetan.
  if (score.masterBars.some((m) => m.section)) {
    const letters = new Map<string, string>();
    a.sections = scoreSections(score).map((x) => {
      const key = x.name.toLowerCase();
      if (!letters.has(key)) letters.set(key, x.marker || String.fromCharCode(65 + letters.size));
      return { b0: x.b, b1: x.e, label: letters.get(key)!, name: x.name };
    });
  }
  // Contrapunto: la pista más aguda contra la más grave (su línea extrema de cada una).
  const avg = (ns: RawNote[]) => ns.reduce((s, n) => s + n.p, 0) / Math.max(1, ns.length);
  const byPitch = pitched.slice().sort((x, y) => avg(y.notes) - avg(x.notes));
  const up = pitched.find((t) => t.t === upper) ?? byPitch[0];
  const lo = pitched.find((t) => t.t === lower) ?? byPitch[byPitch.length - 1];
  const line = (ns: RawNote[], top: boolean): VNote[] => {
    const at = new Map<number, RawNote>();
    for (const n of ns) { const k = Math.round(n.s * 96); const cur = at.get(k); if (!cur || (top ? n.p > cur.p : n.p < cur.p)) at.set(k, n); }
    const list = [...at.values()].sort((x, y) => x.s - y.s);
    return list.map((n, i) => ({ q0: n.s, q1: Math.min(n.e, list[i + 1]?.s ?? n.e), p: n.p })).filter((n) => n.q1 > n.q0);
  };
  if (up && lo && up !== lo) a.counterpoint = analyzeCounterpoint(line(up.notes, true), line(lo.notes, false), meter, [up.name, lo.name]);
  else if (up) {
    // Una sola pista: su voz aguda contra su voz grave.
    a.counterpoint = analyzeCounterpoint(line(up.notes, true), line(up.notes, false).filter((n) => n.p < 60), meter, [`${up.name} (aguda)`, `${up.name} (grave)`]);
  }
  return { ...a, voices: { upper: up?.t ?? -1, lower: lo?.t ?? -1 } };
}
