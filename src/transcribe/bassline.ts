// Línea de bajo con YIN (de Cheveigné y Kawahara, 2002) sobre el bajo ya separado: en los graves es
// más confiable que un modelo polifónico, que a veces no «oye» la fundamental. Las notas se cortan
// donde la altura cambia o donde hay un nuevo golpe (la energía sube de golpe), así las notas repetidas
// del bajo no se funden. Implementación propia con autocorrelación por FFT.
import { fft } from "./dsp";
import type { RawNote } from "./types";

/** Bajo: 22 050 → 5 512 Hz (suficiente y 4× más rápido), de 30 a 400 Hz. */
export const trackBass = (pcm22: Float32Array, sr22 = 22050) => trackMono(pcm22, sr22, 30, 400, 4, 64, 23, 67);
/** Voz cantada: 22 050 → 11 025 Hz, de 80 a 1000 Hz. */
export const trackVoice = (pcm22: Float32Array, sr22 = 22050) => trackMono(pcm22, sr22, 80, 1000, 2, 128, 40, 88, 0.12);

export function trackMono(pcm22: Float32Array, sr22: number, fmin: number, fmax: number, DS: number, hop: number, lo: number, hi: number, minDur = 0.07): RawNote[] {
  // Diezmado con un pasabajas simple (promedio de 4 y luego de 2 vecinos).
  const sr = sr22 / DS, n = Math.floor(pcm22.length / DS), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < DS; k++) s += pcm22[i * DS + k] ?? 0; x[i] = s / DS; }
  const W = 1024, tauMax = Math.ceil(sr / fmin), tauMin = Math.floor(sr / fmax), N = 2048;
  const frames = Math.max(0, Math.floor((n - W - tauMax) / hop));
  const fps = sr / hop;
  const f0 = new Float64Array(frames).fill(NaN), en = new Float64Array(frames);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  const sq = new Float64Array(W + tauMax + 1);
  let maxE = 0;
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    let e = 0;
    for (let j = 0; j < W; j++) e += x[o + j] * x[o + j];
    en[f] = Math.sqrt(e / W);
    if (en[f] > maxE) maxE = en[f];
  }
  const d = new Float64Array(tauMax + 1);
  for (let f = 0; f < frames; f++) {
    if (en[f] < maxE * 0.03) continue;
    const o = f * hop;
    // r(τ) = Σ_j a[j]·b[j+τ] por FFT (a: ventana de W; b: ventana de W + τmax).
    ar.fill(0); ai.fill(0); br.fill(0); bi.fill(0);
    for (let j = 0; j < W; j++) ar[j] = x[o + j];
    for (let j = 0; j < W + tauMax && j < N; j++) br[j] = x[o + j];
    fft(ar, ai); fft(br, bi);
    for (let k = 0; k < N; k++) { const r = ar[k] * br[k] + ai[k] * bi[k], i = ar[k] * bi[k] - ai[k] * br[k]; br[k] = r; bi[k] = -i; }
    fft(br, bi); // correlación (conjugando dos veces)
    sq[0] = 0;
    for (let j = 0; j < W + tauMax; j++) sq[j + 1] = sq[j] + x[o + j] * x[o + j];
    const e0 = sq[W];
    let run = 0, best = -1, bestV = 1;
    d[0] = 0;
    for (let t = 1; t <= tauMax; t++) {
      const r = br[t] / N;
      const et = sq[t + W] - sq[t];
      d[t] = e0 + et - 2 * r;
      run += d[t];
      const cm = run > 0 ? (d[t] * t) / run : 1;
      d[t] = cm; // se guarda la versión normalizada (CMNDF)
    }
    for (let t = tauMin; t < tauMax; t++) {
      if (d[t] < 0.18 && d[t] <= d[t + 1]) { best = t; bestV = d[t]; break; }
    }
    if (best < 0) continue;
    // Interpolación parabólica del mínimo.
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c, shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    const tau = best + Math.max(-1, Math.min(1, shift));
    f0[f] = 69 + 12 * Math.log2(sr / tau / 440);
    if (bestV > 0.18) f0[f] = NaN;
  }
  // Notas: cambio de altura (±0.6 semitonos por 3 cuadros), silencio o un nuevo golpe.
  const out: RawNote[] = [];
  const t = (f: number) => (f * hop + W / 2) / sr;
  let start = -1, sum = 0, cnt = 0, away = 0, peak = 0;
  const close = (end: number) => {
    if (start >= 0 && end - start >= Math.round(minDur * fps)) out.push({ s: t(start), e: t(end), p: Math.round(sum / cnt), a: Math.min(1, 0.3 + (peak / maxE) * 0.9) });
    start = -1; sum = 0; cnt = 0; away = 0; peak = 0;
  };
  for (let f = 0; f < frames; f++) {
    const p = f0[f];
    if (Number.isNaN(p)) { close(f); continue; }
    const attack = f >= 3 && en[f] > 1.6 * en[f - 3] && en[f] > maxE * 0.08;
    if (start < 0) { start = f; sum = p; cnt = 1; peak = en[f]; continue; }
    const cur = sum / cnt;
    if (attack && f - start > Math.round(0.08 * fps)) { close(f); start = f; sum = p; cnt = 1; peak = en[f]; continue; }
    if (Math.abs(p - cur) > 0.6) {
      if (++away >= 3) { const s0 = f - away + 1; close(s0); start = s0; sum = p; cnt = 1; peak = en[f]; }
      continue;
    }
    away = 0; sum += p; cnt++; peak = Math.max(peak, en[f]);
  }
  close(frames);
  return out.filter((nn) => nn.p >= lo && nn.p <= hi);
}
