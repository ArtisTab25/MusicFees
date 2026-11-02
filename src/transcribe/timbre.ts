// Qué instrumento toca cada nota de «lo demás» (lo que queda sin voz, batería ni bajo). Algoritmo propio:
// por nota se mide el timbre en el audio (cómo se apaga, qué tan brillante es, qué tan rápido ataca) y,
// por acorde, si se puede tocar en una guitarra. Con eso se reparten las notas entre guitarra y teclado,
// y se separa la línea principal (un solo, un riff, una melodía de sinte) del acompañamiento.
import { stft } from "./dsp";
import { fretEvents } from "./fretting";
import { fixOctaveSpikes, monophonic } from "./parts";
import type { RawNote } from "./types";

export interface NoteTimbre { sustain: number; bright: number; attack: number }
export interface Layers {
  lead: RawNote[]; guitar: RawNote[]; keys: RawNote[];
  /** Instrumento sugerido para cada capa (preset de MusicFees). */
  hints: { lead: string; guitar: string; keys: string };
  /** Qué tan seguro está del reparto 0–1. */
  conf: number;
}

const STD = [64, 59, 55, 50, 45, 40];

/** Timbre de cada nota a partir del audio de su fuente (mono, 22.05 kHz). */
export function noteTimbres(pcm: Float32Array, sr: number, notes: RawNote[]): NoteTimbre[] {
  const sp = stft(pcm, sr, 2048, 512, 11000);
  const binHz = sr / sp.n, F = sp.mag.length;
  const harm = (f: number, p: number, from: number, to: number) => {
    const f0 = 440 * Math.pow(2, (p - 69) / 12);
    let s = 0;
    for (let h = from; h <= to; h++) {
      const k = Math.round((f0 * h) / binHz);
      if (k <= 0 || k >= sp.bins - 1) continue;
      const m = sp.mag[Math.min(F - 1, Math.max(0, f))];
      s += Math.max(m[k - 1], m[k], m[k + 1]);
    }
    return s;
  };
  return notes.map((n) => {
    const f0 = Math.max(0, Math.round(n.s * sp.fps) + 2);
    let pk = f0, pv = 0;
    for (let f = f0 - 1; f <= f0 + 4; f++) { const v = harm(f, n.p, 1, 4); if (v > pv) { pv = v; pk = f; } }
    const dur = n.e - n.s;
    const later = Math.min(Math.round((n.s + Math.min(0.6, dur * 0.7)) * sp.fps) + 2, Math.round(n.e * sp.fps));
    const sustain = pv > 0 ? Math.min(1.5, harm(later, n.p, 1, 4) / pv) : 0;
    const low = harm(pk, n.p, 1, 3), high = harm(pk, n.p, 6, 12);
    return { sustain, bright: low > 0 ? Math.min(3, high / low) : 0, attack: (pk - (f0 - 2)) / sp.fps };
  });
}

/**
 * Reparte las notas de «lo demás». `beat` es la duración de un tiempo (para agrupar acordes).
 * Sin `timbres` (análisis de partitura) se usa solo la tocabilidad y el registro.
 */
export function splitOther(notes: RawNote[], timbres: NoteTimbre[] | null, beat = 0.5): Layers {
  const idx = notes.map((_, i) => i).sort((a, b) => notes[a].s - notes[b].s);
  const sorted = idx.map((i) => notes[i]), tim = timbres ? idx.map((i) => timbres[i]) : null;
  // 1) Línea principal: la nota más aguda de cada momento cuando sobresale de lo que suena debajo.
  const leadSet = new Set<RawNote>();
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    let top = true, below = -1;
    for (let j = i - 1; j >= 0 && n.s - sorted[j].s < 4; j--) { const m = sorted[j]; if (m.e > n.s + 0.03) { if (m.p > n.p) top = false; else below = Math.max(below, m.p); } }
    for (let j = i + 1; j < sorted.length && sorted[j].s - n.s < 0.05; j++) { if (sorted[j].p > n.p) top = false; else below = Math.max(below, sorted[j].p); }
    if (top && n.p >= 60 && (below < 0 ? n.e - n.s < beat * 3 : n.p - below >= 5) && n.a >= 0.3) leadSet.add(n);
  }
  let lead = fixOctaveSpikes(monophonic([...leadSet], "high"));
  // Una línea principal tiene que moverse: si casi no tiene notas o repite una sola, no lo es.
  const distinct = new Set(lead.map((n) => n.p)).size;
  if (lead.length < 12 || distinct < 4) { lead = []; leadSet.clear(); }
  // 2) Acompañamiento: por grupo de ataque (acorde) se decide guitarra o teclado.
  const rest = sorted.map((n, i) => ({ n, t: tim?.[i] ?? null })).filter((x) => !leadSet.has(x.n));
  const groups: (typeof rest)[] = [];
  for (const x of rest) {
    const g = groups[groups.length - 1];
    if (g && x.n.s - g[0].n.s < Math.min(0.06, beat / 6)) g.push(x); else groups.push([x]);
  }
  const keysScore = (g: typeof rest): number => {
    const ps = g.map((x) => x.n.p).sort((a, b) => a - b);
    let s = 0;
    // Registro y número de notas: fuera de la guitarra o más de 6 notas → teclado.
    if (ps[0] < 40 || ps[ps.length - 1] > 88) s += 1.2;
    if (ps.length > 6) s += 1.5;
    if (ps[ps.length - 1] - ps[0] > 36) s += 0.8;
    // Segundas apretadas (cluster) son de teclado; en guitarra son raras.
    let clusters = 0;
    for (let k = 1; k < ps.length; k++) if (ps[k] - ps[k - 1] <= 2) clusters++;
    s += clusters * 0.35;
    // ¿Se puede tocar en la guitarra sin quitar notas?
    if (ps.length >= 3) { const r = fretEvents([ps.slice().reverse()], STD); if (r.dropped) s += 0.9; else s -= 0.4; }
    // Timbre: los teclados sostienen sin brillo extra (pad, órgano) o se apagan lento (piano);
    // la guitarra limpia se apaga rápido y la distorsionada es muy brillante.
    const ts = g.map((x) => x.t).filter(Boolean) as NoteTimbre[];
    if (ts.length) {
      const sus = avg(ts.map((t) => t.sustain)), br = avg(ts.map((t) => t.bright)), at = avg(ts.map((t) => t.attack));
      if (br > 0.9) s -= 0.8;                 // distorsión: muchos armónicos agudos
      if (sus > 0.75 && br < 0.35) s += 0.7;  // sostenido y opaco: órgano / pad
      if (at > 0.05) s += 0.4;                // ataque lento: pad o cuerdas
      if (sus < 0.25 && br < 0.6) s -= 0.3;   // se apaga rápido: púa
    }
    return s;
  };
  const scores = groups.map(keysScore);
  // Suavizado: un acorde suelto no cambia de instrumento a mitad de una frase.
  const sm = scores.map((_, i) => { const w = scores.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b); return w[w.length >> 1]; });
  const guitar: RawNote[] = [], keys: RawNote[] = [];
  groups.forEach((g, i) => (sm[i] > 0.35 ? keys : guitar).push(...g.map((x) => x.n)));
  // Si una de las dos capas es casi nada, todo va a la otra (mejor una pista limpia que dos a medias).
  const total = guitar.length + keys.length || 1;
  if (keys.length / total < 0.12) { guitar.push(...keys); keys.length = 0; }
  else if (guitar.length / total < 0.12) { keys.push(...guitar); guitar.length = 0; }
  // Sugerencias de instrumento por timbre.
  const tOf = (set: RawNote[]) => { const s = new Set(set); return (tim ?? []).filter((_, i) => s.has(sorted[i])); };
  const gT = tOf(guitar), kT = tOf(keys), lT = tOf(lead);
  const bright = (ts: NoteTimbre[]) => avg(ts.map((t) => t.bright)), sustain = (ts: NoteTimbre[]) => avg(ts.map((t) => t.sustain));
  const hints = {
    guitar: gT.length && bright(gT) > 0.9 ? "gtr_dist" : gT.length && bright(gT) > 0.55 ? "gtr_od" : "gtr_clean",
    keys: kT.length && sustain(kT) > 0.75 ? (bright(kT) < 0.3 ? "pad_warm" : "organ") : kT.length && bright(kT) > 0.5 ? "rhodes" : "piano",
    lead: lT.length && bright(lT) > 0.9 ? "gtr_dist" : lT.length && sustain(lT) > 0.8 ? "lead_saw" : "gtr_clean",
  };
  const conf = Math.min(1, Math.abs(avg(sm)) / 1.5 + (timbres ? 0.3 : 0));
  return { lead, guitar, keys, hints, conf };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Limpia una línea de una sola voz (voz cantada, bajo): una nota a la vez, une pedazos de la misma
 * nota que el modelo partió (vibrato, ligados), quita notas sueltas muy cortas y saltos de octava.
 */
export function cleanLine(notes: RawNote[], prefer: "high" | "low", minDur = 0.08, merge = true): RawNote[] {
  const mono = monophonic(notes, prefer);
  const merged: RawNote[] = [];
  for (const n of mono) {
    const last = merged[merged.length - 1];
    if (merge && last && last.p === n.p && n.s - last.e < 0.09) { last.e = n.e; last.a = Math.max(last.a, n.a); continue; }
    merged.push({ ...n });
  }
  const kept = merged.filter((n) => n.e - n.s >= minDur || n.a >= 0.6);
  return fixOctaveSpikes(kept);
}
