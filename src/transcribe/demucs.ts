// Separación en 6 fuentes con Demucs v4 «htdemucs_6s» (Meta, MIT): batería, bajo, lo demás, voz,
// guitarra y piano. La red se exportó a ONNX sin la STFT/ISTFT (ONNX no las tiene), así que aquí se
// hace todo lo de alrededor igual que `demucs.apply.apply_model`: normalización, trozos de 7,8 s con
// 25 % de solape y ventana triangular, el espectro complejo como canales y la ISTFT de la rama de
// frecuencia, que se suma a la rama de tiempo. Puro: la inferencia llega como función (worker o Node).
import { fft } from "./dsp";

export const DEMUCS_SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type DemucsSource = (typeof DEMUCS_SOURCES)[number];
/** Muestras por trozo (7,8 s a 44.1 kHz) y tamaño del espectro que espera la red. */
export const DEMUCS_SEG = 343980;
const NFFT = 4096, HL = 1024, FR = 2048;
const LE = Math.ceil(DEMUCS_SEG / HL); // 336 cuadros
const PAD = (HL / 2) * 3; // 1536

export type DemucsInfer = (mix: Float32Array, spec: Float32Array) => Promise<{ freq: Float32Array; time: Float32Array }>;

let win: Float64Array | null = null;
const hann = () => { if (!win) { win = new Float64Array(NFFT); for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT); } return win; };

/** Espectro de un trozo estéreo [2][DEMUCS_SEG] → tensor [1, 4, 2048, 336] (L real, L imag, R real, R imag). */
export function demucsSpec(chs: Float32Array[]): Float32Array {
  const w = hann(), n = DEMUCS_SEG, out = new Float32Array(4 * FR * LE);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), norm = 1 / Math.sqrt(NFFT);
  // Señal con relleno por reflejo de 1536 a la izquierda (y hasta múltiplo de 1024 + 1536 a la derecha).
  const at = (x: Float32Array, k: number) => { let j = k - PAD; if (j < 0) j = -j; else if (j >= n) j = 2 * (n - 1) - j; return x[j] ?? 0; };
  chs.forEach((x, c) => {
    for (let t = 0; t < LE; t++) {
      // Cuadro t de la salida = cuadro t+2 de torch.stft(center=True): empieza en t·1024 de la señal rellenada.
      const s = t * HL;
      for (let k = 0; k < NFFT; k++) { re[k] = at(x, s + k) * w[k]; im[k] = 0; }
      fft(re, im);
      for (let f = 0; f < FR; f++) {
        out[((c * 2) * FR + f) * LE + t] = re[f] * norm;
        out[((c * 2 + 1) * FR + f) * LE + t] = im[f] * norm;
      }
    }
  });
  return out;
}

/** ISTFT de la rama de frecuencia de una fuente (canales cac) → [2][DEMUCS_SEG]. */
function demucsIspec(freq: Float32Array, src: number): Float32Array[] {
  const w = hann(), frames = LE + 4, len = (frames - 1) * HL + NFFT;
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), scale = Math.sqrt(NFFT) / NFFT;
  const env = new Float64Array(len);
  for (let t = 0; t < frames; t++) for (let k = 0; k < NFFT; k++) env[t * HL + k] += w[k] * w[k];
  const base = (src * 4) * FR * LE;
  return [0, 1].map((c) => {
    const acc = new Float64Array(len);
    for (let t = 2; t < LE + 2; t++) {
      const j = t - 2;
      re.fill(0); im.fill(0);
      for (let f = 0; f < FR; f++) { re[f] = freq[base + ((c * 2) * FR + f) * LE + j]; im[f] = freq[base + ((c * 2 + 1) * FR + f) * LE + j]; }
      // El bin de Nyquist (2048) quedó en cero; espectro hermítico e iFFT por conjugación.
      im[0] = 0;
      for (let f = 1; f < FR; f++) { re[NFFT - f] = re[f]; im[NFFT - f] = -im[f]; }
      for (let k = 0; k < NFFT; k++) im[k] = -im[k];
      fft(re, im);
      const o = t * HL;
      for (let k = 0; k < NFFT; k++) acc[o + k] += re[k] * scale * w[k];
    }
    // center=True quita 2048 al principio; luego se quitan los 1536 del relleno de la STFT.
    const out = new Float32Array(DEMUCS_SEG), off = NFFT / 2 + PAD;
    for (let i = 0; i < DEMUCS_SEG; i++) { const a = i + off; out[i] = env[a] > 1e-10 ? acc[a] / env[a] : 0; }
    return out;
  });
}

/**
 * Separa la mezcla estéreo (44.1 kHz) completa. `want`: qué fuentes calcular (la ISTFT es lo caro
 * fuera de la red). Devuelve cada fuente en estéreo.
 */
export async function separateDemucs(L: Float32Array, R: Float32Array, infer: DemucsInfer, want: DemucsSource[],
  onChunk: (done: number, total: number) => void = () => {}): Promise<Partial<Record<DemucsSource, [Float32Array, Float32Array]>>> {
  const n = L.length;
  // Normalización de toda la pista (como demucs.separate): media y desviación de la mezcla mono.
  let mu = 0; for (let i = 0; i < n; i++) mu += (L[i] + R[i]) / 2; mu /= n || 1;
  let v = 0; for (let i = 0; i < n; i++) { const d = (L[i] + R[i]) / 2 - mu; v += d * d; } const sd = Math.sqrt(v / Math.max(1, n - 1)) || 1;
  const nl = new Float32Array(n), nr = new Float32Array(n);
  for (let i = 0; i < n; i++) { nl[i] = (L[i] - mu) / sd; nr[i] = (R[i] - mu) / sd; }
  const seg = DEMUCS_SEG, stride = Math.floor(0.75 * seg);
  const half = seg >> 1, weight = new Float32Array(seg);
  for (let i = 0; i < half; i++) weight[i] = (i + 1) / half;
  for (let i = half; i < seg; i++) weight[i] = (seg - i) / half;
  const idx = want.map((s) => DEMUCS_SOURCES.indexOf(s));
  const out = idx.map(() => [new Float32Array(n), new Float32Array(n)]);
  const sumW = new Float32Array(n);
  const offsets: number[] = []; for (let o = 0; o < n; o += stride) offsets.push(o);
  for (let k = 0; k < offsets.length; k++) {
    const offset = offsets[k], cl = Math.min(seg, n - offset), delta = seg - cl, start = offset - Math.floor(delta / 2);
    // Trozo de 7,8 s con contexto real alrededor (ceros fuera de la pista).
    const cL = new Float32Array(seg), cR = new Float32Array(seg);
    for (let i = 0; i < seg; i++) { const j = start + i; if (j >= 0 && j < n) { cL[i] = nl[j]; cR[i] = nr[j]; } }
    const mix = new Float32Array(2 * seg); mix.set(cL, 0); mix.set(cR, seg);
    const { freq, time } = await infer(mix, demucsSpec([cL, cR]));
    const trim = Math.floor(delta / 2);
    idx.forEach((s, q) => {
      const [fl, fr] = demucsIspec(freq, s);
      const tb = s * 2 * seg;
      for (let i = 0; i < cl; i++) {
        const w = weight[i], a = trim + i;
        out[q][0][offset + i] += w * (fl[a] + time[tb + a]);
        out[q][1][offset + i] += w * (fr[a] + time[tb + seg + a]);
      }
    });
    for (let i = 0; i < cl; i++) sumW[offset + i] += weight[i];
    onChunk(k + 1, offsets.length);
  }
  const res: Partial<Record<DemucsSource, [Float32Array, Float32Array]>> = {};
  want.forEach((s, q) => {
    const [a, b] = out[q];
    for (let i = 0; i < n; i++) { const z = sumW[i] || 1; a[i] = (a[i] / z) * sd + mu; b[i] = (b[i] / z) * sd + mu; }
    res[s] = [a, b];
  });
  return res;
}
