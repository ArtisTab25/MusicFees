// Beat This! (Foscarin, Schlüter, Widmer, ISMIR 2024 · CPJKU, licencia MIT): red que encuentra pulsos y
// tiempos fuertes directamente en el audio. Aquí van el espectrograma que espera (log-mel a 50 cuadros por
// segundo), el recorrido por trozos de 30 s y la búsqueda de picos «mínima» del proyecto original.
// Puro: la inferencia llega como función, así corre igual en el worker (onnxruntime-web) y en Node.
import { fft } from "./dsp";

export const BT_SR = 22050, BT_FPS = 50;
const NFFT = 1024, HOP = 441, NMEL = 128, FMIN = 30, FMAX = 11000;
const CHUNK = 1500, BORDER = 6;

const hzToMel = (f: number) => (f < 1000 ? (3 * f) / 200 : 15 + (27 * Math.log(f / 1000)) / Math.log(6.4));
const melToHz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) * (m - 15)) / 27));

let FB: Float32Array[] | null = null;
/** Banco de filtros mel (escala Slaney, sin normalizar), 513 × 128, como torchaudio. */
export function melBank(): Float32Array[] {
  if (FB) return FB;
  const nb = NFFT / 2 + 1, lo = hzToMel(FMIN), hi = hzToMel(FMAX);
  const pts = Array.from({ length: NMEL + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (NMEL + 1)));
  FB = Array.from({ length: nb }, (_, k) => {
    const f = (k * BT_SR) / NFFT, row = new Float32Array(NMEL);
    for (let m = 0; m < NMEL; m++) {
      const up = (f - pts[m]) / (pts[m + 1] - pts[m]), down = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
      row[m] = Math.max(0, Math.min(up, down));
    }
    return row;
  });
  return FB;
}

/** Espectrograma log-mel de Beat This! (audio mono a 22 050 Hz): [cuadros][128]. */
export function btSpectrogram(x: Float32Array): Float32Array[] {
  const fb = melBank(), half = NFFT / 2, n = x.length;
  const frames = Math.floor(n / HOP) + 1;
  const win = new Float64Array(NFFT); for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT);
  const at = (i: number) => { // relleno por reflejo, como center=True
    if (n === 1) return x[0];
    while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i;
    return x[i];
  };
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), mag = new Float64Array(half + 1);
  const out: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const s = f * HOP - half;
    for (let i = 0; i < NFFT; i++) { re[i] = at(s + i) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / 32;
    const row = new Float32Array(NMEL);
    for (let k = 0; k <= half; k++) { const v = mag[k]; if (!v) continue; const w = fb[k]; for (let m = 0; m < NMEL; m++) row[m] += v * w[m]; }
    for (let m = 0; m < NMEL; m++) row[m] = Math.log(1 + 1000 * row[m]);
    out.push(row);
  }
  return out;
}

/** La red: espectrograma [1, T, 128] → logits de pulso y de tiempo fuerte, [T] cada uno. */
export type BtInfer = (spec: Float32Array, frames: number) => Promise<{ beat: Float32Array; downbeat: Float32Array }>;

/** Recorre la canción en trozos de 30 s (con 6 cuadros de borde que se descartan) y une los logits. */
export async function btLogits(spec: Float32Array[], infer: BtInfer, onChunk: (done: number, total: number) => void = () => {}) {
  const n = spec.length, beat = new Float32Array(n).fill(-1000), down = new Float32Array(n).fill(-1000);
  const starts: number[] = []; for (let s = -BORDER; s < n - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  for (let c = 0; c < starts.length; c++) {
    const a = Math.max(starts[c], 0), b = Math.min(starts[c] + CHUNK, n), len = b - a;
    const buf = new Float32Array(len * NMEL); for (let i = 0; i < len; i++) buf.set(spec[a + i], i * NMEL);
    const r = await infer(buf, len);
    const lo = a === 0 ? 0 : BORDER, hi = b === n ? len : len - BORDER;
    beat.set(r.beat.subarray(lo, hi), a + lo); down.set(r.downbeat.subarray(lo, hi), a + lo);
    onChunk(c + 1, starts.length);
  }
  return { beat, down };
}

/** Picos: máximos locales (±3 cuadros) con logit > 0; los pegados se promedian. En segundos. */
export function btPeaks(x: Float32Array): number[] {
  const idx: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] <= 0) continue;
    let mx = true; for (let j = Math.max(0, i - 3); j <= Math.min(x.length - 1, i + 3); j++) if (x[j] > x[i]) { mx = false; break; }
    if (mx) idx.push(i);
  }
  const out: number[] = [];
  for (let k = 0; k < idx.length;) { let e = k; while (e + 1 < idx.length && idx[e + 1] - idx[e] === 1) e++; let s = 0; for (let j = k; j <= e; j++) s += idx[j]; out.push(s / (e - k + 1) / BT_FPS); k = e + 1; }
  return out;
}

/** Pulsos y tiempos fuertes (cada tiempo fuerte se pega al pulso más cercano). */
export async function beatThis(mono22: Float32Array, infer: BtInfer, onChunk?: (done: number, total: number) => void) {
  const { beat, down } = await btLogits(btSpectrogram(mono22), infer, onChunk);
  const beats = btPeaks(beat);
  const downbeats = beats.length ? [...new Set(btPeaks(down).map((t) => beats.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), beats[0])))] : [];
  return { beats, downbeats };
}
