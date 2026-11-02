// Rasgos del audio para el análisis: función de ataque general y de graves, tempo y tiempos, golpes de
// batería en la parte percusiva y la intensidad por segundo. Puro (corre en el worker).
import { bandFlux, logBands, normalize, peaks, percussive, rmsPerSecond, smooth, stft } from "./dsp";
import { estimateTempo, trackBeats } from "./rhythm";
import type { AudioFeatures } from "./analyze";
import type { RawNote } from "./types";

const LAG = 2;
export interface Rhythm { features: AudioFeatures; tempo: number; tempoConf: number; beats: number[]; drums: RawNote[] }

export function audioRhythm(pcm: Float32Array, sr: number, wantDrums: boolean, progress: (msg: string) => void = () => {}): Rhythm {
  progress("Midiendo el ritmo…");
  const sp = stft(pcm, sr, 2048, 512, 11000);
  const lb = logBands(sp, 96, 30, 11000);
  // Ataques generales (todas las bandas) y de los graves.
  // Cada cuadro mide una ventana de 2048 muestras: el golpe queda a la mitad (2 cuadros de 512 después
  // del inicio de la ventana). Se recorren 2 cuadros para que los tiempos caigan donde suena.
  const shift = (x: Float32Array) => { const y = new Float32Array(x.length); y.set(x.subarray(0, x.length - LAG), LAG); return y; };
  const onset = shift(smooth(bandFlux(lb.mag, lb.centers, 30, 11000), 3));
  const bassOnset = shift(smooth(bandFlux(lb.mag, lb.centers, 30, 180), 3));
  const { bpm, conf } = estimateTempo(onset, sp.fps);
  const beats = trackBeats(onset, sp.fps, bpm);
  // Tempo final: la mediana de la separación real entre tiempos.
  const gaps = beats.slice(1).map((t, i) => t - beats[i]).sort((a, b) => a - b);
  const tempo = gaps.length ? Math.round((60 / gaps[gaps.length >> 1]) * 2) / 2 : bpm;
  let drums: RawNote[] = [];
  if (wantDrums) {
    progress("Separando la batería…");
    const perc = percussive({ ...sp, mag: lb.mag, bins: 96 }, 17, 9);
    drums = classifyDrums(perc, lb.centers, sp.fps);
  }
  const rms = normalize(rmsPerSecond(pcm, sr));
  return { features: { onset, bassOnset, fps: sp.fps, rms }, tempo, tempoConf: conf, beats, drums };
}

/**
 * Golpes de batería: ataques de la parte percusiva y, en cada uno, cuánto sube la energía en graves
 * (bombo), medios (caja) y agudos (platillos). Cada banda se compara con sus golpes más fuertes, así
 * que funciona igual con baterías bajitas o fuertes. Algoritmo propio.
 */
export function classifyDrums(perc: Float32Array[], centers: number[], fps: number): RawNote[] {
  const on = peaks(smooth(bandFlux(perc, centers, 30, 11000), 2), fps, 0.06, 0.07);
  const band = (lo: number, hi: number) => centers.map((c, k) => (c >= lo && c < hi ? k : -1)).filter((k) => k >= 0);
  const B = { low: band(35, 150), mid: band(180, 3000), high: band(6000, 11000) };
  const rise = (i: number, ks: number[]) => {
    let a = 0, b = 0;
    for (let f = i; f <= i + 2; f++) for (const k of ks) a += perc[f]?.[k] ?? 0;
    for (let f = i - 3; f <= i - 1; f++) for (const k of ks) b += perc[f]?.[k] ?? 0;
    return Math.max(0, a / 3 - b / 3) / ks.length;
  };
  const rows = on.map((p) => ({ t: (p.i + LAG) / fps, v: p.v, low: rise(p.i, B.low), mid: rise(p.i, B.mid), high: rise(p.i, B.high) }));
  const p90 = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)] || 1; };
  const nl = p90(rows.map((r) => r.low)), nm = p90(rows.map((r) => r.mid)), nh = p90(rows.map((r) => r.high));
  const out: RawNote[] = [];
  for (const r of rows) {
    const L = r.low / nl, M = r.mid / nm, H = r.high / nh;
    // Bombo: sube sobre todo el grave. Caja: medios con ruido agudo y poco grave. Hi-hat: solo agudos.
    const kick = L >= 0.6 && L >= 0.7 * M;
    const snare = !kick && M >= 0.45 && H >= 0.55;
    const hat = !kick && !snare && H >= 0.3 && M < 0.3 && L < 0.3;
    const add = (p: number, a: number) => out.push({ s: r.t, e: r.t + 0.1, p, a: Math.min(1, a) });
    if (kick) add(36, L);
    if (snare) add(38, M);
    if (hat) add(42, H);
  }
  return out;
}
