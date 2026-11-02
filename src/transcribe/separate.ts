// Separación de fuentes con MDX-Net (KUIELab, Music Demixing Challenge 2021; modelos ONNX publicados
// por el proyecto Ultimate Vocal Remover, licencia MIT). Cada modelo recibe el espectrograma
// complejo estéreo de un trozo de ~12 s y devuelve el de su fuente: voz, batería o bajo. «Lo demás»
// (guitarras, teclados, metales…) es la mezcla menos esas tres.
// Puro: la inferencia llega como función, así corre igual en el worker (onnxruntime-web) y en Node.
import { fft } from "./dsp";

export type Stem = "vocals" | "drums" | "bass";
/** Tamaño de FFT con que se entrenó cada modelo (dim_f = 2048, dim_t = 512, salto 1024). */
export const MDX_NFFT: Record<Stem, number> = { vocals: 6144, drums: 4096, bass: 16384 };
const HOP = 1024, DIM_F = 2048, DIM_T = 512;
export const MDX_CHUNK = HOP * (DIM_T - 1);

const hannCache = new Map<number, Float64Array>();
function hann(n: number) {
  let w = hannCache.get(n);
  if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); hannCache.set(n, w); }
  return w;
}

const twiddles = new Map<number, { c: Float64Array; s: Float64Array }>();
/** FFT de tamaño cualquiera múltiplo de una potencia de 2 por 3 (6144 = 2048·3): radix mixto sencillo. */
function fftAny(re: Float64Array, im: Float64Array) {
  const n = re.length;
  if ((n & (n - 1)) === 0) { fft(re, im); return; }
  if (n % 3 !== 0) throw new Error(`FFT de ${n} no soportada`);
  const m = n / 3;
  const parts = [0, 1, 2].map((k) => {
    const r = new Float64Array(m), i = new Float64Array(m);
    for (let j = 0; j < m; j++) { r[j] = re[3 * j + k]; i[j] = im[3 * j + k]; }
    fftAny(r, i);
    return { r, i };
  });
  let tw = twiddles.get(n);
  if (!tw) { tw = { c: new Float64Array(2 * n), s: new Float64Array(2 * n) }; for (let k = 0; k < 2 * n; k++) { const a = (-2 * Math.PI * k) / n; tw.c[k] = Math.cos(a); tw.s[k] = Math.sin(a); } twiddles.set(n, tw); }
  for (let k = 0; k < n; k++) {
    const km = k % m;
    let sr = parts[0].r[km], si = parts[0].i[km];
    for (let q = 1; q < 3; q++) {
      const c = tw.c[q * k], s = tw.s[q * k];
      const pr = parts[q].r[km], pi = parts[q].i[km];
      sr += pr * c - pi * s; si += pr * s + pi * c;
    }
    re[k] = sr; im[k] = si;
  }
}

/**
 * Corre un modelo sobre la mezcla estéreo completa (44.1 kHz). `infer` recibe el tensor
 * [1, 4, 2048, 512] (L real, L imag, R real, R imag) y devuelve el de la fuente.
 */
export async function separateStem(L: Float32Array, R: Float32Array, nfft: number,
  infer: (x: Float32Array) => Promise<Float32Array>, onChunk: (done: number, total: number) => void = () => {}): Promise<[Float32Array, Float32Array]> {
  const n = L.length, trim = nfft / 2, gen = MDX_CHUNK - 2 * trim;
  const pad = gen - (n % gen);
  const total = n + pad;
  const padded = (x: Float32Array) => { const p = new Float32Array(trim + n + pad + trim); p.set(x, trim); return p; };
  const PL = padded(L), PR = padded(R);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const bins = nfft / 2 + 1, w = hann(nfft);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const chunks = Math.ceil(total / gen);
  for (let c = 0, i = 0; i < total; i += gen, c++) {
    const x = new Float32Array(4 * DIM_F * DIM_T);
    // STFT centrada (relleno por reflejo, como torch.stft center=True) de cada canal.
    [PL, PR].forEach((src, ch) => {
      for (let t = 0; t < DIM_T; t++) {
        const start = i + t * HOP - nfft / 2;
        for (let k = 0; k < nfft; k++) {
          let j = start + k - i; // posición dentro del trozo
          if (j < 0) j = -j; else if (j >= MDX_CHUNK) j = 2 * (MDX_CHUNK - 1) - j;
          re[k] = (src[i + j] ?? 0) * w[k]; im[k] = 0;
        }
        fftAny(re, im);
        for (let f = 0; f < DIM_F; f++) {
          x[((ch * 2) * DIM_F + f) * DIM_T + t] = re[f];
          x[((ch * 2 + 1) * DIM_F + f) * DIM_T + t] = im[f];
        }
      }
    });
    const y = await infer(x);
    // ISTFT con suma solapada y normalización por la ventana al cuadrado.
    const seg = MDX_CHUNK + nfft;
    [outL, outR].forEach((dst, ch) => {
      const acc = new Float64Array(seg), norm = new Float64Array(seg);
      for (let t = 0; t < DIM_T; t++) {
        re.fill(0); im.fill(0);
        for (let f = 0; f < DIM_F; f++) { re[f] = y[((ch * 2) * DIM_F + f) * DIM_T + t]; im[f] = y[((ch * 2 + 1) * DIM_F + f) * DIM_T + t]; }
        // Espectro hermítico → señal real (iFFT por conjugación).
        for (let f = 1; f < bins - 1; f++) { re[nfft - f] = re[f]; im[nfft - f] = -im[f]; }
        for (let k = 0; k < nfft; k++) im[k] = -im[k];
        fftAny(re, im);
        const o = t * HOP;
        for (let k = 0; k < nfft; k++) { acc[o + k] += (re[k] / nfft) * w[k]; norm[o + k] += w[k] * w[k]; }
      }
      // Muestra j del trozo = acc[j + nfft/2]; se guarda [trim, trim + gen).
      for (let j = trim; j < trim + gen; j++) {
        const pos = i + j - trim;
        if (pos >= n) break;
        const a = j + nfft / 2;
        dst[pos] = norm[a] > 1e-8 ? acc[a] / norm[a] : 0;
      }
    });
    onChunk(c + 1, chunks);
  }
  return [outL, outR];
}

/** Mezcla estéreo 44.1 kHz → mono 22.05 kHz (filtro pasabajas de media banda y diezmado 2:1). */
export function toMono22k(L: Float32Array, R: Float32Array): Float32Array {
  const taps = 31, h = new Float64Array(taps), c = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - c, sinc = x === 0 ? 0.5 : Math.sin(Math.PI * 0.5 * x) / (Math.PI * x);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1))); sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const n = Math.floor(L.length / 2), out = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    let s = 0;
    const base = 2 * o - c;
    for (let i = 0; i < taps; i++) { const j = base + i; if (j >= 0 && j < L.length) s += h[i] * (L[j] + R[j]) * 0.5; }
    out[o] = s;
  }
  return out;
}

/** Energía RMS de una señal (para saber si una fuente realmente suena). */
export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i += 2) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length / 2));
}
