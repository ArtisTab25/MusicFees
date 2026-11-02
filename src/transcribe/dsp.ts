// Procesamiento de señal propio: FFT, espectrograma, separación armónico/percusiva (HPSS por
// filtros de mediana) y funciones de ataque por banda. Sin dependencias, pensado para un worker.

/** FFT compleja in situ (radix 2). `re` e `im` deben medir una potencia de 2. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export interface Spectrogram {
  /** Magnitudes por cuadro: frames × bins (solo hasta `bins`). */
  mag: Float32Array[];
  bins: number;
  hop: number;
  sr: number;
  n: number;
  /** Cuadros por segundo. */
  fps: number;
}

/** Espectrograma de magnitud con ventana de Hann. Se guardan solo los bins hasta `maxHz`. */
export function stft(x: Float32Array, sr: number, n = 2048, hop = 512, maxHz = 11000): Spectrogram {
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const bins = Math.min(n / 2, Math.ceil((maxHz / sr) * n));
  const frames = Math.max(1, Math.floor((x.length - n) / hop) + 1);
  const re = new Float64Array(n), im = new Float64Array(n);
  const mag: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < n; i++) { re[i] = (x[o + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(bins);
    for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k]);
    mag.push(m);
  }
  return { mag, bins, hop, sr, n, fps: sr / hop };
}

/** Mediana de un trozo (selección rápida sobre una copia de trabajo). */
function median(buf: Float32Array, len: number): number {
  let lo = 0, hi = len - 1;
  const k = len >> 1;
  while (lo < hi) {
    const pivot = buf[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (buf[i] < pivot) i++;
      while (buf[j] > pivot) j--;
      if (i <= j) { const t = buf[i]; buf[i] = buf[j]; buf[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return buf[k];
}

/**
 * Separación armónico/percusiva (Fitzgerald 2010): lo que se sostiene en el tiempo es armónico
 * (mediana a lo largo del tiempo), lo que es ancho en frecuencia es percusivo (mediana a lo largo
 * de la frecuencia). Devuelve el espectrograma percusivo con máscara suave.
 */
export function percussive(sp: Spectrogram, kt = 17, kf = 17): Float32Array[] {
  const F = sp.mag.length, B = sp.bins, ht = kt >> 1, hf = kf >> 1;
  const buf = new Float32Array(Math.max(kt, kf));
  const out: Float32Array[] = [];
  for (let f = 0; f < F; f++) {
    const m = sp.mag[f], p = new Float32Array(B);
    for (let k = 0; k < B; k++) {
      // Armónico: mediana en el tiempo
      let n = 0;
      for (let d = -ht; d <= ht; d++) { const g = f + d; if (g >= 0 && g < F) buf[n++] = sp.mag[g][k]; }
      const H = median(buf, n);
      // Percusivo: mediana en frecuencia
      n = 0;
      for (let d = -hf; d <= hf; d++) { const q = k + d; if (q >= 0 && q < B) buf[n++] = m[q]; }
      const P = median(buf, n);
      const hp = H * H, pp = P * P;
      p[k] = m[k] * (pp / (hp + pp + 1e-12));
    }
    out.push(p);
  }
  return out;
}

/**
 * Agrupa el espectrograma en `nb` bandas espaciadas logarítmicamente (como el oído). Mucho más ligero
 * para separar y detectar ataques. Devuelve también la frecuencia central de cada banda.
 */
export function logBands(sp: Spectrogram, nb = 96, lo = 30, hi = 11000): { mag: Float32Array[]; centers: number[] } {
  const edges = Array.from({ length: nb + 1 }, (_, i) => lo * Math.pow(hi / lo, i / nb));
  const binOf = (hz: number) => Math.max(1, Math.min(sp.bins - 1, Math.round((hz / sp.sr) * sp.n)));
  const ranges = edges.slice(0, -1).map((e, i) => { const a = binOf(e), b = Math.max(a + 1, binOf(edges[i + 1])); return [a, b]; });
  const mag = sp.mag.map((m) => {
    const out = new Float32Array(nb);
    ranges.forEach(([a, b], i) => { let s = 0; for (let k = a; k < b; k++) s += m[k]; out[i] = s / (b - a); });
    return out;
  });
  return { mag, centers: edges.slice(0, -1).map((e, i) => Math.sqrt(e * edges[i + 1])) };
}

/** Flujo espectral (logarítmico, solo subidas) de las bandas entre `loHz` y `hiHz`, normalizado a 0–1. */
export function bandFlux(mag: Float32Array[], centers: number[], loHz: number, hiHz: number): Float32Array {
  const ks = centers.map((c, k) => (c >= loHz && c <= hiHz ? k : -1)).filter((k) => k >= 0);
  const out = new Float32Array(mag.length);
  for (let f = 1; f < mag.length; f++) {
    let s = 0;
    const a = mag[f], b = mag[f - 1];
    for (const k of ks) { const d = Math.log1p(100 * a[k]) - Math.log1p(100 * b[k]); if (d > 0) s += d; }
    out[f] = s;
  }
  return normalize(out);
}

export function normalize(x: Float32Array): Float32Array {
  let mx = 0;
  for (const v of x) if (v > mx) mx = v;
  if (mx > 0) for (let i = 0; i < x.length; i++) x[i] /= mx;
  return x;
}

/** Suavizado con ventana de Hann de `w` cuadros. */
export function smooth(x: Float32Array, w = 3): Float32Array {
  if (w < 2) return x;
  const k = Array.from({ length: w }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (w + 1)));
  const sum = k.reduce((a, b) => a + b, 0), h = w >> 1;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = 0; j < w; j++) { const q = i + j - h; if (q >= 0 && q < x.length) s += x[q] * k[j]; }
    out[i] = s / sum;
  }
  return out;
}

/**
 * Picos de una función de ataque con umbral adaptable (mediana local + delta) y separación mínima.
 * Devuelve índices de cuadro y su fuerza.
 */
export function peaks(x: Float32Array, fps: number, delta = 0.08, minGap = 0.06, win = 0.5): { i: number; v: number }[] {
  const out: { i: number; v: number }[] = [];
  const h = Math.max(1, Math.round(win * fps)), gap = Math.max(1, Math.round(minGap * fps));
  const buf = new Float32Array(2 * h + 1);
  let last = -1e9;
  for (let i = 1; i < x.length - 1; i++) {
    if (!(x[i] >= x[i - 1] && x[i] > x[i + 1])) continue;
    let n = 0;
    for (let j = i - h; j <= i + h; j++) if (j >= 0 && j < x.length) buf[n++] = x[j];
    const thr = median(buf, n) + delta;
    if (x[i] < thr) continue;
    if (i - last < gap) { if (out.length && x[i] > out[out.length - 1].v) { out[out.length - 1] = { i, v: x[i] }; last = i; } continue; }
    out.push({ i, v: x[i] });
    last = i;
  }
  return out;
}

/** Energía RMS por segundo (para estimar la intensidad de cada sección). */
export function rmsPerSecond(x: Float32Array, sr: number): Float32Array {
  const n = Math.max(1, Math.ceil(x.length / sr));
  const out = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    let acc = 0, c = 0;
    for (let i = s * sr; i < Math.min(x.length, (s + 1) * sr); i += 4) { acc += x[i] * x[i]; c++; }
    out[s] = Math.sqrt(acc / Math.max(1, c));
  }
  return out;
}
