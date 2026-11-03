// Modo «Fiel», después de separar: transcribe cada fuente y arma el análisis. Puro (sin worker ni modelos)
// para probarlo en Node con las mismas reglas que la app; el detector de notas se pasa como función.
import { audioRhythm } from "./features";
import { analyzeNotes } from "./analyze";
import { transcribeDrums } from "./drums";
import { trackBass } from "./bassline";
import { noteTimbres } from "./timbre";
import type { Analysis, RawNote } from "./types";

export const SR = 22050;
/** Umbral de presencia (fuente/mezcla) por segundo para guitarra y piano separados. */
export const GATE = { guitar: 0.12, piano: 0.12 };
export type NotesFn = (pcm: Float32Array, label: string, from: number, span: number) => Promise<RawNote[]>;
export interface MonoStems { vocals: Float32Array; drums: Float32Array; bass: Float32Array; other: Float32Array; guitar?: Float32Array; piano?: Float32Array }

/** Por segundo: cuánto pesa una fuente respecto a la mezcla (para no transcribir lo que solo se coló). */
export function presence(src: Float32Array, mix: Float32Array): Float32Array {
  const n = Math.ceil(src.length / SR), out = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    let a = 0, b = 0;
    for (let i = s * SR; i < Math.min(src.length, (s + 1) * SR); i += 2) { a += src[i] * src[i]; b += mix[i] * mix[i]; }
    out[s] = b > 0 ? Math.sqrt(a / b) : 0;
  }
  return out;
}

export async function transcribeSeparated(mix: Float32Array, mono: MonoStems, opts: { mode: "mix" | "solo"; drums: boolean },
  notesOf: NotesFn, progress: (pct: number, msg: string) => void = () => {}): Promise<Analysis> {
  // La voz solo cuenta donde realmente suena (si no, es lo que se coló de otros instrumentos).
  const vp = presence(mono.vocals, mix);
  const sung = vp.filter((x) => x >= 0.12).length;
  let vocals: RawNote[] = [];
  const minSung = Math.min(8, Math.max(3, vp.length * 0.3));
  if (sung >= minSung) {
    vocals = (await notesOf(mono.vocals, "Escuchando la voz", 60, 8))
      .filter((n) => (vp[Math.floor(n.s)] ?? 0) >= 0.12 && n.p >= 40 && n.p <= 88);
  }
  progress(68, "Siguiendo la línea del bajo…");
  // YIN es más fiel que el modelo polifónico en los graves; si casi no encuentra nada, se usa el modelo.
  let bassNotes = trackBass(mono.bass, SR);
  if (bassNotes.length < 20) bassNotes = (await notesOf(mono.bass, "Escuchando el bajo", 70, 6)).filter((n) => n.p <= 67);
  let guitar: RawNote[] | undefined, keys: RawNote[] | undefined, guitarTimbre: ReturnType<typeof noteTimbres> | null = null;
  if (mono.guitar && mono.piano) {
    // Solo donde cada fuente pesa de verdad (si no, es lo que se coló de las demás).
    const gate = async (src: Float32Array, label: string, from: number, thr: number) => {
      const pr = presence(src, mix);
      if (pr.filter((x) => x >= thr).length < Math.min(6, pr.length * 0.15)) return [];
      return (await notesOf(src, label, from, 6)).filter((n) => (pr[Math.floor(n.s)] ?? 0) >= thr);
    };
    guitar = await gate(mono.guitar, "Escuchando la guitarra", 72, GATE.guitar);
    keys = await gate(mono.piano, "Escuchando el piano", 78, GATE.piano);
    guitarTimbre = noteTimbres(mono.guitar, SR, guitar);
  }
  const otherNotes = await notesOf(mono.other, mono.guitar ? "Escuchando lo demás" : "Escuchando guitarras y teclados", 84, mono.guitar ? 4 : 12);
  progress(89, "Leyendo la batería: bombo, caja, toms y platillos…");
  const dp = presence(mono.drums, mix);
  const drumHits = opts.drums && dp.filter((x) => x >= 0.15).length >= 8 ? transcribeDrums(mono.drums, SR) : [];
  progress(92, "Reconociendo instrumentos por su timbre…");
  const otherTimbre = noteTimbres(mono.other, SR, otherNotes);
  progress(95, "Midiendo el ritmo y la armonía…");
  const r = audioRhythm(mix, SR, false);
  const half = halveByBackbeat(r.beats, drumHits);
  if (half) { r.beats = half; r.tempo /= 2; }
  const analysis = analyzeNotes({ notes: [], drums: drumHits, beats: r.beats, duration: mix.length / SR, tempo: r.tempo, mode: opts.mode, audio: r.features,
    stems: { vocals, bass: bassNotes, other: otherNotes, otherTimbre, guitar, keys, guitarTimbre } });
  if (r.tempoConf < 0.35) analysis.notesForUser.push("El pulso no es muy marcado: revisa el tempo y dónde empieza el compás.");
  if (!vocals.length && sung < minSung) analysis.notesForUser.push("No encontré voz cantada: la melodía principal sale de los instrumentos.");
  return analysis;
}

/**
 * Tempo al doble (error típico con semicorcheas): en 4/4 la caja cae cada 2 tiempos (2 y 4). Si con el
 * tempo detectado cae casi siempre cada 4, el pulso real es la mitad: se toma un tiempo de cada dos,
 * con la fase en la que el bombo cae en los tiempos que quedan.
 */
export function halveByBackbeat(beats: number[], drums: RawNote[]): number[] | null {
  if (beats.length < 16) return null;
  const sn = drums.filter((d) => d.p === 38 && d.a >= 0.3).map((d) => d.s);
  if (sn.length < 8) return null;
  const pos = (t: number) => { let lo = 0, hi = beats.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; } return lo + (t - beats[lo]) / Math.max(1e-6, beats[hi] - beats[lo]); };
  // ¿En qué tiempo del grupo de 4 cae cada golpe de caja (de los que caen en un tiempo)?
  const res = [0, 0, 0, 0];
  let onBeat = 0;
  for (const t of sn) { const q = pos(t), r = Math.round(q); if (Math.abs(q - r) < 0.2) { res[((r % 4) + 4) % 4]++; onBeat++; } }
  if (onBeat < 8) return null;
  const top = res.indexOf(Math.max(...res));
  // Tempo correcto: la caja se reparte entre dos tiempos opuestos (2 y 4). Al doble: casi todo en uno.
  if (res[top] < onBeat * 0.6 || res[(top + 2) % 4] > onBeat * 0.15) return null;
  const spb = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  // Menos de ~60 bpm es raro: más bien es un ritmo «a medio tiempo» (caja solo en el 3) y se deja.
  if (60 / (spb * 2) < 58) return null;
  const kicks = drums.filter((d) => d.p === 36).map((d) => d.s);
  let best = 0, bv = -1;
  for (const ph of [0, 1]) { let v = 0; for (const k of kicks) { const q = pos(k); const r = Math.round(q); if (Math.abs(q - r) < 0.15 && ((r - ph) & 1) === 0) v++; } if (v > bv) { bv = v; best = ph; } }
  return beats.filter((_, i) => ((i - best) & 1) === 0);
}
