// Técnicas de guitarra a partir del audio de la pista de guitarra (separada o importada) y de sus notas:
// bend, vibrato, slide, hammer-on/pull-off y palm mute. Reglas sobre la curva de afinación de cada nota
// (seguida en un armónico para tener resolución fina) y sobre cómo se apaga.
// Puro: corre igual en el worker y en Node. Medido contra las técnicas escritas en las partituras de Brayand
// (4 nov 2026): todavía NO fiable (bends 0 de 32 marcados acertados, vibrato 1 de 27, palm mute 0 de 3), así que
// la app no lo usa (opción `techniques` apagada). Queda la medición lista para mejorarlo.
import { fft } from "./dsp";
import type { RawNote } from "./types";

export type Tech = "bend" | "vibrato" | "slide" | "hammer" | "palmMute";
export interface TechOpts { bend: number; vib: number; pmDecay: number; pmBright: number; hammerGap: number; hammerAtt: number; slide: number }
export const TECH_OPTS: TechOpts = { bend: 70, vib: 18, pmDecay: 0.3, pmBright: 0.85, hammerGap: 0.035, hammerAtt: 0.45, slide: 0.45 };

const N = 2048, HOP = 220; // ~93 ms de ventana, 10 ms de paso (a 22 050 Hz)
const hz = (p: number) => 440 * 2 ** ((p - 69) / 12);

interface Frames { mag: Float32Array[]; flux: Float32Array; cent: Float32Array; rms: Float32Array; sr: number }
function analyze(x: Float32Array, sr: number, t0: number, t1: number): Frames {
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const a = Math.max(0, Math.floor(t0 * sr) - N / 2), b = Math.min(x.length, Math.ceil(t1 * sr));
  const mag: Float32Array[] = [], cent: number[] = [], rms: number[] = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = a; s + N <= b + N / 2 && s < x.length; s += HOP) {
    let e = 0;
    for (let i = 0; i < N; i++) { const v = (x[s + i] ?? 0) * win[i]; re[i] = v; im[i] = 0; e += v * v; }
    fft(re, im);
    const m = new Float32Array(N / 2); let num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) { m[k] = Math.hypot(re[k], im[k]); num += k * m[k]; den += m[k]; }
    mag.push(m); cent.push(den ? (num / den) * sr / N : 0); rms.push(Math.sqrt(e / N));
  }
  const flux = new Float32Array(mag.length);
  for (let f = 1; f < mag.length; f++) { let s = 0; for (let k = 2; k < 400; k++) { const d = mag[f][k] - mag[f - 1][k]; if (d > 0) s += d; } flux[f] = s; }
  return { mag, flux, cent: Float32Array.from(cent), rms: Float32Array.from(rms), sr };
}

/** Desvío de afinación (centésimas) cuadro a cuadro de una nota, siguiendo el armónico más útil. */
function pitchCurve(F: Frames, f0: number, fa: number, fb: number, lo = -150, hi = 260): number[] {
  const h = Math.max(1, Math.min(6, Math.ceil(450 / f0)));
  const out: number[] = [];
  for (let f = fa; f < fb && f < F.mag.length; f++) {
    const m = F.mag[f], c = (h * f0 * N) / F.sr;
    const k0 = Math.max(2, Math.floor(c * 2 ** (lo / 1200))), k1 = Math.min(m.length - 2, Math.ceil(c * 2 ** (hi / 1200)));
    let k = k0; for (let j = k0; j <= k1; j++) if (m[j] > m[k]) k = j;
    const y0 = m[k - 1], y1 = m[k], y2 = m[k + 1], d = y0 - 2 * y1 + y2;
    const kk = k + (d ? (0.5 * (y0 - y2)) / d : 0);
    out.push(1200 * Math.log2(kk / c));
  }
  return out;
}

/**
 * Marca técnicas en las notas de una línea de guitarra (las notas deben venir de esa pista). Devuelve, por
 * nota, la lista de técnicas detectadas. Solo se usa con notas de guitarra; acordes plaqué solo reciben palm mute.
 */
export function detectTechniques(audio: Float32Array, sr: number, notes: RawNote[], o: TechOpts = TECH_OPTS): Tech[][] {
  const out: Tech[][] = notes.map(() => []);
  if (!notes.length) return out;
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].s - notes[b].s);
  // Se analiza por tramos para no guardar el espectrograma entero (memoria del teléfono).
  const span = 20;
  const t0 = notes[order[0]].s, t1 = Math.max(...notes.map((n) => n.e));
  // brillo típico de la pista (para el palm mute)
  const brightAll: number[] = [];
  const frameOf = (F: Frames, base: number, t: number) => Math.round((t * sr - base) / HOP);
  const per: { F: Frames; base: number; from: number; to: number }[] = [];
  for (let a = t0 - 0.2; a < t1; a += span) per.push({ F: analyze(audio, sr, a, a + span + 1), base: Math.max(0, Math.floor(a * sr) - N / 2), from: a, to: a + span });
  const seg = (t: number) => per.find((p) => t >= p.from && t < p.to) ?? per[per.length - 1];
  const info = order.map((i) => {
    const n = notes[i], P = seg(n.s), F = P.F;
    const fa = Math.max(0, frameOf(F, P.base, n.s) + 2), fb = Math.min(F.mag.length, frameOf(F, P.base, n.e));
    const pk = F.rms.subarray(fa, Math.min(fa + 6, F.rms.length)).reduce((x, y) => Math.max(x, y), 0);
    const later = F.rms[Math.min(F.rms.length - 1, fa + 12)] ?? 0; // +120 ms
    const br = F.cent.subarray(fa, Math.min(fa + 8, F.cent.length)).reduce((x, y) => x + y, 0) / Math.max(1, Math.min(8, F.cent.length - fa));
    brightAll.push(br);
    const chordal = notes.some((m, j) => j !== i && Math.abs(m.s - n.s) < 0.03);
    return { i, n, P, F, fa, fb, pk, decay: pk ? later / pk : 1, br, chordal };
  });
  const medBr = [...brightAll].sort((a, b) => a - b)[brightAll.length >> 1] || 1;
  for (let k = 0; k < info.length; k++) {
    const x = info[k], { n, F, fa, fb } = x;
    const dur = n.e - n.s;
    // Palm mute: se apaga muy rápido y suena opaco para esta pista
    if (dur < 0.4 && x.decay < o.pmDecay && x.br < medBr * o.pmBright) out[x.i].push("palmMute");
    if (x.chordal || fb - fa < 6) continue;
    const curve = pitchCurve(F, hz(n.p), fa, fb);
    if (curve.length < 6) continue;
    const base = [...curve.slice(0, 4)].sort((a, b) => a - b)[1];
    const rel = curve.map((c) => c - base);
    // Bend: sube y se sostiene (≥ 6 cuadros por encima del umbral)
    let up = 0; for (const c of rel) if (c > o.bend) up++;
    if (up >= 6 && Math.max(...rel) > o.bend + 20) out[x.i].push("bend");
    // Vibrato: oscila (cruces por la media) con amplitud suficiente, ~4–8 por segundo
    else if (rel.length >= 15) {
      const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
      let cross = 0; for (let j = 1; j < rel.length; j++) if ((rel[j] - mean) * (rel[j - 1] - mean) < 0) cross++;
      const amp = Math.sqrt(rel.reduce((a, b) => a + (b - mean) ** 2, 0) / rel.length);
      const rate = cross / 2 / (rel.length * HOP / sr);
      if (amp > o.vib && rate > 3.5 && rate < 9) out[x.i].push("vibrato");
    }
    // Slide / hammer-on / pull-off hacia la nota siguiente (sin silencio entre ambas)
    const y = info[k + 1];
    if (!y || y.chordal) continue;
    const gap = y.n.s - n.e, iv = y.n.p - n.p;
    if (gap > o.hammerGap || iv === 0 || Math.abs(iv) > 7) continue;
    // ¿la afinación del final de esta nota ya camina hacia la siguiente?
    const tail = rel.slice(-5), move = (tail[tail.length - 1] - tail[0]) / (100 * iv);
    if (Math.abs(iv) >= 2 && move > o.slide) { out[x.i].push("slide"); continue; }
    // Hammer/pull: la nota siguiente casi no tiene ataque propio
    const fy = frameOf(y.F, y.P.base, y.n.s);
    const att = (y.F.flux[Math.min(y.F.flux.length - 1, fy + 1)] ?? 0) + (y.F.flux[Math.min(y.F.flux.length - 1, fy + 2)] ?? 0);
    const fx0 = frameOf(F, x.P.base, n.s);
    const own = (F.flux[Math.min(F.flux.length - 1, fx0 + 1)] ?? 0) + (F.flux[Math.min(F.flux.length - 1, fx0 + 2)] ?? 0);
    if (Math.abs(iv) <= 5 && own > 0 && att / own < o.hammerAtt) out[x.i].push("hammer");
  }
  return out;
}
