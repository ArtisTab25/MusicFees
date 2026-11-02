// Línea de bajo (y otras líneas de una nota) sobre la fuente ya separada. Algoritmo propio en dos capas:
// 1) los ATAQUES se buscan con ventanas cortas (≈ 46 ms), para que las notas empiecen donde suenan y las
//    notas repetidas no se fundan; 2) la ALTURA de cada nota sale de YIN (de Cheveigné y Kawahara, 2002)
//    con la mediana de los cuadros que caen dentro de la nota, con corrección de octava. Si la altura
//    cambia sin ataque (ligado, hammer-on) la nota también se corta. Autocorrelación por FFT.
// Calibrado con las partituras de Brayand (bajos de 4 cuerdas, rock y funk).
import { fft } from "./dsp";
import type { RawNote } from "./types";

/** Bajo: 22 050 → 5 512 Hz (suficiente y 4× más rápido), de 30 a 400 Hz. */
export const trackBass = (pcm22: Float32Array, sr22 = 22050) => trackMono(pcm22, sr22, 30, 400, 4, 64, 23, 67);
/** Voz cantada: 22 050 → 11 025 Hz, de 80 a 1000 Hz. */
export const trackVoice = (pcm22: Float32Array, sr22 = 22050) => trackMono(pcm22, sr22, 80, 1000, 2, 128, 40, 88, 0.12);

export interface MonoOpts { rise?: number; riseHi?: number; yinThr?: number; octThr?: number; W?: number; hpHz?: number; insK?: number; insGap?: number;
  /** Señal para buscar ataques (p. ej. la mezcla sin batería): conserva los golpes que la separación suaviza. */
  onset?: Float32Array; riseLo?: number; lpHz?: number; hiFromOnset?: boolean }

export function trackMono(pcm22: Float32Array, sr22: number, fmin: number, fmax: number, DS: number, hop: number, lo: number, hi: number, minDur = 0.07, o: MonoOpts = {}): RawNote[] {
  const RISE = o.rise ?? 2, RISE_HI = o.riseHi ?? 3, THR = o.yinThr ?? 0.04, OCT = o.octThr ?? 0.1;
  // Diezmado con un pasabajas simple (promedio de DS vecinos).
  const sr = sr22 / DS, n = Math.floor(pcm22.length / DS), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < DS; k++) s += pcm22[i * DS + k] ?? 0; x[i] = s / DS; }
  const tauMax = Math.ceil(sr / fmin), tauMin = Math.max(2, Math.floor(sr / fmax));
  const W = o.W ?? Math.max(256, Math.min(1024, 1 << Math.ceil(Math.log2(tauMax * 2.6))));
  const N = 1 << Math.ceil(Math.log2(W + tauMax + 1));
  const frames = Math.max(0, Math.floor((n - W - tauMax) / hop));
  const fps = sr / hop;
  // ---------- 1) energía corta y ataques ----------
  const Wo = Math.round(0.046 * sr);
  const nf = Math.floor((n - Wo) / hop);
  const edb = new Float64Array(Math.max(0, nf));
  let maxDb = -200;
  for (let f = 0; f < nf; f++) {
    let e = 0; const o0 = f * hop;
    for (let j = 0; j < Wo; j++) e += x[o0 + j] * x[o0 + j];
    edb[f] = 10 * Math.log10(e / Wo + 1e-12);
    if (edb[f] > maxDb) maxDb = edb[f];
  }
  const floor = maxDb - 38;
  const flux = new Float64Array(nf);
  for (let f = 2; f < nf; f++) flux[f] = Math.max(0, edb[f] - Math.max(edb[f - 2], floor - 6));
  // Graves de la señal de ataques (la separación del bajo usa ventanas largas y borra los golpes).
  const fluxL = new Float64Array(nf);
  const RISE_LO = o.riseLo ?? 1.5;
  if (o.onset) {
    const src = o.onset, lpN = Math.max(1, Math.round(sr / (o.lpHz ?? 250)));
    const y = new Float32Array(n); let acc = 0;
    const xs = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = 0; for (let k = 0; k < DS; k++) v += src[i * DS + k] ?? 0; xs[i] = v / DS; }
    for (let i = 0; i < n; i++) { acc += xs[i]; if (i >= lpN) acc -= xs[i - lpN]; y[i] = acc / lpN; }
    const ldb = new Float64Array(nf); let mx = -200;
    for (let f = 0; f < nf; f++) { let e = 0; const o0 = f * hop; for (let j = 0; j < Wo; j++) e += y[o0 + j] * y[o0 + j]; ldb[f] = 10 * Math.log10(e / Wo + 1e-12); if (ldb[f] > mx) mx = ldb[f]; }
    for (let f = 0; f < nf; f++) ldb[f] = Math.max(ldb[f], mx - 40);
    for (let f = 2; f < nf; f++) fluxL[f] = Math.max(0, ldb[f] - ldb[f - 2]);
  }
  // Banda alta (el «clic» de la púa o del dedo): delata las notas repetidas aunque el volumen casi no suba.
  const hpN = Math.max(2, Math.round(sr22 / (o.hpHz ?? 350)));
  const hdb = new Float64Array(Math.max(0, nf));
  {
    const hs = o.onset && o.hiFromOnset ? o.onset : pcm22;
    let acc = 0; const ma = new Float32Array(hs.length);
    for (let i = 0; i < hs.length; i++) { acc += hs[i]; if (i >= hpN) acc -= hs[i - hpN]; ma[i] = acc / Math.min(i + 1, hpN); }
    const Wh = Wo * DS;
    let maxH = -200;
    for (let f = 0; f < nf; f++) {
      const o0 = f * hop * DS; let e = 0;
      for (let j = 0; j < Wh; j += 2) { const v = (hs[o0 + j] ?? 0) - (ma[o0 + j + (hpN >> 1)] ?? 0); e += v * v; }
      hdb[f] = 10 * Math.log10(e / (Wh / 2) + 1e-12); if (hdb[f] > maxH) maxH = hdb[f];
    }
    for (let f = 0; f < nf; f++) hdb[f] = Math.max(hdb[f], maxH - 45);
  }
  const fluxH = new Float64Array(nf);
  for (let f = 2; f < nf; f++) fluxH[f] = Math.max(0, hdb[f] - hdb[f - 2]);
  const onsets: number[] = [];
  const gap = Math.round(0.06 * fps);
  for (let f = 2; f < nf - 1; f++) {
    if (edb[f] < floor + 6) continue;
    const sc = (g: number) => Math.max(flux[g] / RISE, fluxH[g] / RISE_HI, fluxL[g] / RISE_LO);
    const v = sc(f);
    if (v < 1) continue;
    const vp = sc(f - 1), vn = sc(f + 1);
    if (v < vp || v < vn) continue;
    // El ataque real está al principio de la subida: se busca hacia atrás dónde empezó.
    let s = f; while (s > 1 && edb[s - 1] < edb[s] - 0.4 && f - s < 4) s--;
    if (onsets.length && s - onsets[onsets.length - 1] < gap) continue;
    onsets.push(s);
  }
  const tOn = (f: number) => (f * hop + Wo * 0.5) / sr;
  const dbg = (globalThis as { MF_DEBUG?: (k: string, v: unknown) => void }).MF_DEBUG;
  dbg?.("bass", { onsets: onsets.map(tOn), edb, flux, fluxH, fluxL, fps, Wo: Wo / sr });
  // ---------- 2) altura por cuadro (YIN con corrección de octava) ----------
  const f0 = new Float64Array(frames).fill(NaN);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  const sq = new Float64Array(W + tauMax + 1);
  const d = new Float64Array(tauMax + 2);
  for (let f = 0; f < frames; f++) {
    const o0 = f * hop;
    const ef = Math.floor((o0 + W / 2 - Wo / 2) / hop);
    if (ef >= 0 && ef < nf && edb[ef] < floor + 3) continue;
    ar.fill(0); ai.fill(0); br.fill(0); bi.fill(0);
    for (let j = 0; j < W; j++) ar[j] = x[o0 + j];
    for (let j = 0; j < W + tauMax && j < N; j++) br[j] = x[o0 + j];
    fft(ar, ai); fft(br, bi);
    for (let k = 0; k < N; k++) { const r = ar[k] * br[k] + ai[k] * bi[k], i = ar[k] * bi[k] - ai[k] * br[k]; br[k] = r; bi[k] = -i; }
    fft(br, bi);
    sq[0] = 0;
    for (let j = 0; j < W + tauMax; j++) sq[j + 1] = sq[j] + x[o0 + j] * x[o0 + j];
    const e0 = sq[W];
    let run = 0;
    d[0] = 1;
    for (let t = 1; t <= tauMax; t++) {
      const v = e0 + (sq[t + W] - sq[t]) - (2 * br[t]) / N;
      run += v;
      d[t] = run > 0 ? (v * t) / run : 1;
    }
    let best = -1;
    for (let t = tauMin; t < tauMax; t++) if (d[t] < THR && d[t] <= d[t + 1] && d[t] <= d[t - 1]) { best = t; break; }
    if (best < 0) {
      // Sin cruce del umbral: el mínimo global, si es razonable.
      let bv = 1; for (let t = tauMin; t < tauMax; t++) if (d[t] < bv) { bv = d[t]; best = t; }
      if (bv > THR * 1.75) continue;
    }
    // Corrección de octava: si en la mitad del periodo también hay un buen mínimo, la nota es una octava arriba.
    const h = Math.round(best / 2);
    if (h >= tauMin) { let m = h; for (let t = h - 1; t <= h + 1; t++) if (d[t] < d[m]) m = t; if (d[m] < OCT && d[m] < d[best] + 0.15) best = m; }
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c, shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    const tau = best + Math.max(-1, Math.min(1, shift));
    f0[f] = 69 + 12 * Math.log2(sr / tau / 440);
  }
  // Cuadro de altura cuyo centro cae en el instante t.
  const fAt = (t: number) => Math.round((t * sr - W / 2) / hop);
  const voicedAt = (t: number) => { const f = fAt(t); return f >= 0 && f < frames && !Number.isNaN(f0[f]); };
  // Ataques también donde la señal vuelve a ser periódica: al pulsar de nuevo la cuerda, la vibración se
  // desordena un instante. Así se separan notas repetidas que casi no cambian de volumen (umbral YIN bajo).
  const onT = onsets.map(tOn);
  for (let f = 0; f < frames; f++) {
    if (!Number.isNaN(f0[f]) && (f === 0 || Number.isNaN(f0[f - 1]))) {
      const t = (f * hop + W / 2) / sr - (W / 2) / sr * (o.insK ?? 1);
      if (!onT.some((u) => Math.abs(u - t) < (o.insGap ?? 0.06))) onT.push(Math.max(0, t));
    }
  }
  onT.sort((a, b) => a - b);
  // ---------- 3) notas: de ataque a ataque ----------
  const out: RawNote[] = [];
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  const halfW = W / 2 / sr;
  for (let i = 0; i < onT.length; i++) {
    const t0 = onT[i], t1 = i + 1 < onT.length ? onT[i + 1] : n / sr;
    // Cuadros cuya ventana cae (casi) dentro de la nota.
    const fa = Math.max(0, fAt(Math.min(t1, t0 + halfW * 0.8))), fb = Math.min(frames - 1, fAt(Math.max(t0 + halfW * 0.8, t1 - halfW * 0.6)));
    const run: number[] = [], idx: number[] = [];
    for (let f = fa; f <= fb; f++) if (!Number.isNaN(f0[f])) { run.push(f0[f]); idx.push(f); }
    if (!run.length) { const f = fAt(t0 + halfW); if (f >= 0 && f < frames && !Number.isNaN(f0[f])) { run.push(f0[f]); idx.push(f); } }
    if (!run.length) continue;
    // Fin: donde se apaga (energía) o deja de tener altura, sin pasar del siguiente ataque.
    let end = t1;
    const peakF = Math.max(0, Math.floor((t0 * sr - Wo / 2) / hop));
    let pk = -200; for (let f = peakF; f < Math.min(nf, peakF + Math.round(0.12 * fps)); f++) pk = Math.max(pk, edb[f]);
    for (let f = peakF + 2; f < nf && (f * hop + Wo / 2) / sr < t1; f++) if (edb[f] < Math.max(floor, pk - 24)) { end = (f * hop + Wo / 2) / sr; break; }
    let lastV = -1; for (let f = idx[idx.length - 1]; f < frames && (f * hop + W / 2) / sr < end; f++) { if (Number.isNaN(f0[f])) break; lastV = f; }
    if (lastV >= 0) end = Math.min(end, (lastV * hop + W / 2) / sr + halfW * 0.5);
    end = Math.max(end, Math.min(t1, t0 + 0.05));
    // Ligados: la altura cambia de forma estable dentro de la nota → se corta ahí.
    const segs: { s: number; e: number; ps: number[] }[] = [{ s: t0, e: end, ps: [] }];
    let cur = segs[0], ref = run[0], away = 0;
    for (let k = 0; k < run.length; k++) {
      const p = run[k];
      if (Math.abs(p - ref) > 0.7) {
        if (++away >= 3 && cur.ps.length >= 2) {
          const ts = (idx[k - 2] * hop + W / 2) / sr - halfW * 0.5;
          // Muy cerca del ataque: los primeros cuadros todavía oían la nota anterior; se descartan.
          if (ts < cur.s + 0.1 && segs.length === 1) { cur.ps = run.slice(k - 2, k + 1); ref = p; away = 0; continue; }
          cur.e = ts; cur = { s: ts, e: end, ps: run.slice(k - 2, k + 1) }; segs.push(cur); ref = p; away = 0; continue;
        }
      } else { away = 0; ref = cur.ps.length ? ref * 0.8 + p * 0.2 : p; }
      cur.ps.push(p);
    }
    for (const sg of segs) {
      if (sg.e - sg.s < minDur * 0.7 || !sg.ps.length) continue;
      const p = Math.round(med(sg.ps));
      if (p < lo || p > hi) continue;
      const fe = Math.max(0, Math.floor((sg.s * sr - Wo / 2) / hop));
      out.push({ s: sg.s, e: sg.e, p, a: Math.min(1, Math.max(0.2, 0.25 + ((edb[Math.min(nf - 1, fe + 2)] ?? floor) - floor) / 40)) });
    }
  }
  void voicedAt;
  dbg?.("bassF0", { f0, t0: W / 2 / sr, fps });
  return out;
}
