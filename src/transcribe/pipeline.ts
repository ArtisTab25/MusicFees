// Modo «Fiel», después de separar: transcribe cada fuente y arma el análisis. Puro (sin worker ni modelos)
// para probarlo en Node con las mismas reglas que la app; el detector de notas se pasa como función.
import { audioRhythm } from "./features";
import { analyzeNotes } from "./analyze";
import { transcribeDrums } from "./drums";
import { trackBass } from "./bassline";
import { noteTimbres } from "./timbre";
import type { Analysis, InstrumentHint, RawNote } from "./types";

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

export async function transcribeSeparated(mix: Float32Array, mono: MonoStems, opts: { mode: "mix" | "solo"; drums: boolean; hint?: InstrumentHint; rhythm?: NeuralRhythm },
  notesOf: NotesFn, progress: (pct: number, msg: string) => void = () => {}): Promise<Analysis> {
  const hint = opts.hint ?? {};
  // La voz solo cuenta donde realmente suena (si no, es lo que se coló de otros instrumentos). Si el
  // usuario dice que hay voz, basta con menos; si dice que no, ni se escucha.
  const vThr = hint.vocals ? 0.06 : 0.12;
  const vp = presence(mono.vocals, mix);
  const sung = vp.filter((x) => x >= vThr).length;
  let vocals: RawNote[] = [];
  const minSung = hint.vocals ? 1 : Math.min(8, Math.max(3, vp.length * 0.3));
  if (hint.vocals !== false && sung >= minSung) {
    vocals = (await notesOf(mono.vocals, "Escuchando la voz", 60, 8))
      .filter((n) => (vp[Math.floor(n.s)] ?? 0) >= vThr && n.p >= 40 && n.p <= 88);
  }
  progress(68, "Siguiendo la línea del bajo…");
  // YIN es más fiel que el modelo polifónico en los graves; si casi no encuentra nada, se usa el modelo.
  let bassNotes: RawNote[] = [];
  if (hint.bass !== false) {
    bassNotes = trackBass(mono.bass, SR);
    if (bassNotes.length < 20) bassNotes = (await notesOf(mono.bass, "Escuchando el bajo", 70, 6)).filter((n) => n.p <= 67);
  }
  let guitar: RawNote[] | undefined, keys: RawNote[] | undefined, guitarTimbre: ReturnType<typeof noteTimbres> | null = null;
  if (mono.guitar && mono.piano) {
    // Solo donde cada fuente pesa de verdad (si no, es lo que se coló de las demás).
    // Si el usuario dice cuántos hay: con 0 no se escucha esa fuente; con 1 o más, basta con menos presencia.
    const gate = async (src: Float32Array, label: string, from: number, thr: number, count: number | undefined) => {
      if (count === 0) return [];
      const t = thr;
      const pr = presence(src, mix);
      if (!count && pr.filter((x) => x >= t).length < Math.min(6, pr.length * 0.15)) return [];
      return (await notesOf(src, label, from, 6)).filter((n) => (pr[Math.floor(n.s)] ?? 0) >= t);
    };
    guitar = await gate(mono.guitar, "Escuchando la guitarra", 72, GATE.guitar, hint.guitars);
    keys = await gate(mono.piano, "Escuchando el piano", 78, GATE.piano, hint.keys);
    guitarTimbre = noteTimbres(mono.guitar, SR, guitar);
  }
  const otherNotes = await notesOf(mono.other, mono.guitar ? "Escuchando lo demás" : "Escuchando guitarras y teclados", 84, mono.guitar ? 4 : 12);
  progress(89, "Leyendo la batería: bombo, caja, toms y platillos…");
  const dp = presence(mono.drums, mix);
  const wantDrums = hint.drums ?? opts.drums;
  const drumHits = wantDrums && (hint.drums || dp.filter((x) => x >= 0.15).length >= 8) ? transcribeDrums(mono.drums, SR) : [];
  progress(92, "Reconociendo instrumentos por su timbre…");
  const otherTimbre = noteTimbres(mono.other, SR, otherNotes);
  progress(95, "Midiendo el ritmo y la armonía…");
  const r = audioRhythm(mix, SR, false);
  const nr = opts.rhythm ? neuralBeats(opts.rhythm, drumHits) : null;
  if (nr) { r.beats = nr.beats; r.tempo = nr.tempo; r.tempoConf = 1; }
  else {
    const half = halveByBackbeat(r.beats, drumHits);
    if (half) { r.beats = half; r.tempo /= 2; }
  }
  const analysis = analyzeNotes({ notes: [], drums: drumHits, beats: r.beats, duration: mix.length / SR, tempo: r.tempo, mode: opts.mode, audio: r.features,
    meter: nr?.meter, downbeat: nr?.downbeat,
    stems: { vocals, bass: bassNotes, other: otherNotes, otherTimbre, guitar, keys, guitarTimbre, hint } });
  if (r.tempoConf < 0.35) analysis.notesForUser.push("El pulso no es muy marcado: revisa el tempo y dónde empieza el compás.");
  if (!vocals.length && hint.vocals !== false && sung < minSung) analysis.notesForUser.push("No encontré voz cantada: la melodía principal sale de los instrumentos.");
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

/** Pulsos y tiempos fuertes de una red (Beat This!): segundos. */
export interface NeuralRhythm { beats: number[]; downbeats: number[] }

/**
 * Pulso, tempo, compás y primer tiempo fuerte a partir de lo que dio la red. El compás es la cantidad de
 * tiempos más común entre tiempos fuertes (MusicFees escribe 3/4 o 4/4: 6 cuenta como 3 y 2 como 4).
 */
export function fromNeural(nr: NeuralRhythm): { beats: number[]; tempo: number; meter?: 3 | 4; downbeat?: number } | null {
  const beats = nr.beats;
  if (beats.length < 8) return null;
  const ibi = beats.slice(1).map((t, i) => t - beats[i]);
  const med = [...ibi].sort((a, b) => a - b)[ibi.length >> 1];
  // Promedio de las separaciones normales (los pulsos vienen en cuadros de 20 ms: la mediana sola redondea el tempo)
  const ok = ibi.filter((d) => Math.abs(d - med) < 0.15 * med);
  const tempo = 60 / (ok.reduce((a, b) => a + b, 0) / ok.length);
  const idx = nr.downbeats.map((d) => { let k = 0; for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - d) < Math.abs(beats[k] - d)) k = i; return k; });
  const cnt: Record<number, number> = {};
  for (let i = 1; i < idx.length; i++) { const n = idx[i] - idx[i - 1]; const m = n === 6 ? 3 : n === 2 || n === 8 ? 4 : n; cnt[m] = (cnt[m] ?? 0) + 1; }
  const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  if (!best || idx.length < 3) return { beats, tempo };
  const meter = (Number(best[0]) === 3 ? 3 : 4) as 3 | 4;
  // Primer tiempo fuerte: la fase más votada (resiste algún tiempo fuerte suelto mal puesto)
  const ph = new Array(meter).fill(0); for (const k of idx) ph[k % meter]++;
  const downbeat = ph.indexOf(Math.max(...ph));
  return { beats, tempo, meter, downbeat };
}

/**
 * Lo de la red con la misma corrección de tempo doble que el detector propio: Beat This! a veces sigue
 * las corcheas (canciones escritas «a medio tiempo»); si la caja cae cada 4 de sus pulsos, se toma la mitad.
 */
export function neuralBeats(nr: NeuralRhythm, drums: RawNote[]) {
  const half = halveByBackbeat(nr.beats, drums);
  // A medio tiempo, los tiempos fuertes de la red caen cada 2 pulsos (la mitad no lo son): el compás y su
  // inicio los decide entonces el análisis propio (acentos, bajo, armonía, patrón de batería).
  return fromNeural(half ? { beats: half, downbeats: [] } : nr);
}
