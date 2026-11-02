// El análisis completo: de notas (y rasgos del audio) a tempo, compás, tonalidad, acordes, estructura,
// partes y contrapunto. Puro: corre en el worker del transcriptor y también sobre una partitura.
import type { Analysis, Part, RawNote } from "./types";
import { beatChroma, detectKey, recognizeChords } from "./harmony";
import { findSections } from "./form";
import { meterAndDownbeat, valueAt } from "./rhythm";
import { removeOvertones, splitRoles } from "./parts";
import { analyzeCounterpoint, type VNote } from "./counterpoint";

/** Posición en tiempos (negras, con decimales) de un instante, según la lista de tiempos. */
export function beatPos(beats: number[], t: number): number {
  const n = beats.length;
  if (n < 2) return t * 2;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

const cosd = (a: number[], b: number[]) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? 1 - s / Math.sqrt(na * nb) : 0;
};

export interface AudioFeatures {
  /** Función de ataque general, de los graves y su fps. */
  onset: Float32Array; bassOnset: Float32Array; fps: number;
  /** Intensidad por segundo. */
  rms: Float32Array;
}

/**
 * Análisis a partir de notas y tiempos ya conocidos. Si `meter` no viene, se detecta con los acentos
 * (ataques del bajo, cambios de armonía y fuerza del golpe en cada tiempo).
 */
export function analyzeNotes(input: {
  notes: RawNote[]; drums?: RawNote[]; beats: number[]; duration: number; tempo: number;
  mode: "mix" | "solo"; meter?: 3 | 4; downbeat?: number; audio?: AudioFeatures;
}): Analysis {
  const { notes, beats, duration, tempo, mode, audio } = input;
  // Del audio: fuera los armónicos fantasma antes de todo lo demás.
  const pitched = (audio ? removeOvertones(notes) : notes).filter((n) => n.e > n.s);
  const { chroma, bass, energy } = beatChroma(pitched, beats);
  // Compás y primer tiempo fuerte
  let meter = input.meter, downbeat = input.downbeat ?? 0;
  if (!meter) {
    const accent = beats.map((t, k) => {
      const ch = k > 0 ? cosd(chroma[k], chroma[k - 1]) : 0;
      const bOn = audio ? valueAt(audio.bassOnset, audio.fps, t) : bassAttack(pitched, t);
      const on = audio ? valueAt(audio.onset, audio.fps, t) : 0;
      return ch * 1.2 + bOn * 1 + on * 0.4;
    });
    const md = meterAndDownbeat(accent);
    meter = md.meter; downbeat = md.downbeat;
  }
  // Tonalidad: histograma de clases de altura ponderado por duración y fuerza.
  const hist = new Array(12).fill(0);
  for (const n of pitched) hist[((n.p % 12) + 12) % 12] += (n.e - n.s) * (0.3 + n.a) * (n.p < 48 ? 0.6 : 1);
  const key = detectKey(hist);
  // Acordes: la probabilidad de cambio depende de dónde cae el tiempo en el compás.
  const strength = beats.map((_, k) => {
    const inBar = (((k - downbeat) % meter!) + meter!) % meter!;
    return inBar === 0 ? 1 : meter === 4 && inBar === 2 ? 0.6 : 0.25;
  });
  const chords = recognizeChords(chroma, bass, energy, key, strength);
  // Estructura: rasgos por compás (armonía media y bajo) + intensidad.
  const off = downbeat > 0 ? downbeat - meter : 0; // compás de anacrusa
  const nBars = Math.max(1, Math.ceil((beats.length - off) / meter));
  const feats: number[][] = [], en: number[] = [];
  for (let b = 0; b < nBars; b++) {
    const f = new Array(24).fill(0);
    let e = 0;
    for (let k = off + b * meter; k < off + (b + 1) * meter; k++) {
      if (k < 0 || k >= beats.length) continue;
      const cs = chroma[k].reduce((x, y) => x + y, 0) || 1, bs = bass[k].reduce((x, y) => x + y, 0) || 1;
      for (let p = 0; p < 12; p++) { f[p] += chroma[k][p] / cs; f[12 + p] += (0.6 * bass[k][p]) / bs; }
      e += audio ? rmsAt(audio.rms, beats[k]) : energy[k];
    }
    feats.push(f); en.push(e);
  }
  const sections = findSections(feats, en);
  // Partes
  const parts: Part[] = [];
  let counterpoint = null;
  const q = (t: number) => beatPos(beats, t) - off;
  if (mode === "mix") {
    const r = splitRoles(pitched);
    if (r.melody.length) parts.push({ role: "melody", notes: r.melody });
    if (r.harmony.length) parts.push({ role: "harmony", notes: cleanHarmony(r.harmony, chords, beats, !!r.bass.length) });
    if (r.bass.length) parts.push({ role: "bass", notes: r.bass });
    const toV = (ns: RawNote[]): VNote[] => ns.map((n) => ({ q0: Math.round(q(n.s) * 4) / 4, q1: Math.round(q(n.e) * 4) / 4, p: n.p })).filter((n) => n.q1 > n.q0);
    if (r.melody.length && r.bass.length) counterpoint = analyzeCounterpoint(toV(r.melody), toV(r.bass), meter);
  } else parts.push({ role: "all", notes: pitched });
  if (input.drums?.length) parts.push({ role: "drums", notes: input.drums });
  // Compases dudosos: notas débiles o muy cortas.
  const perBar = new Map<number, { n: number; weak: number }>();
  for (const n of pitched) {
    const b = Math.floor(q(n.s) / meter);
    const x = perBar.get(b) ?? { n: 0, weak: 0 };
    x.n++; if (n.a < 0.33 || n.e - n.s < 0.06) x.weak++;
    perBar.set(b, x);
  }
  const doubtful = [...perBar].filter(([, x]) => x.n >= 3 && x.weak / x.n > 0.45).map(([b]) => b).sort((a, b) => a - b);
  const notesForUser: string[] = [];
  if (key.conf < 0.25) notesForUser.push("La tonalidad no es clara (modulaciones o poca armonía): revisa la armadura.");
  if (doubtful.length > nBars * 0.3) notesForUser.push("Muchos compases tienen notas débiles: la grabación puede tener ruido o mucha mezcla. Prueba con una pista más limpia o con «Un instrumento».");
  return { duration, tempo, beats, meter, downbeat, key, chords, sections, parts, counterpoint, doubtful, notes: pitched.length, notesForUser };
}

/**
 * Limpieza guiada por la armonía (propio de MusicFees): en la parte de acordes se quitan las notas
 * débiles y cortas que no pertenecen al acorde reconocido en ese tiempo, y las del registro del bajo
 * cuando ya hay pista de bajo. Deja acordes más tocables sin perder notas de paso fuertes.
 */
function cleanHarmony(notes: RawNote[], chords: import("./types").ChordSeg[], beats: number[], hasBass: boolean): RawNote[] {
  const CT: Record<string, number[]> = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], "5": [0, 7] };
  const chordAt = (t: number) => {
    const k = Math.max(0, Math.floor(beatPos(beats, t + 0.02)));
    return chords.find((c) => k >= c.b0 && k <= c.b1);
  };
  const spb = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  return notes.filter((n) => {
    if (hasBass && n.p < 45) return false;
    const c = chordAt(n.s);
    if (!c || c.root < 0) return true;
    const inChord = (CT[c.type] ?? [0, 4, 7]).some((iv) => (c.root + iv) % 12 === ((n.p % 12) + 12) % 12);
    return inChord || n.a >= 0.55 || n.e - n.s >= spb;
  });
}

function rmsAt(rms: Float32Array, t: number) { return rms[Math.min(rms.length - 1, Math.max(0, Math.floor(t)))] ?? 0; }
/** Sin audio (partitura): ¿empieza una nota grave en este tiempo? */
function bassAttack(notes: RawNote[], t: number) {
  let v = 0;
  for (const n of notes) if (n.p < 52 && Math.abs(n.s - t) < 0.05) v = Math.max(v, 0.5 + n.a / 2);
  return v;
}
