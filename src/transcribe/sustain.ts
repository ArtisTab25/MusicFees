// Sostenido contra repetido: el modelo de notas a veces parte una nota larga en varias (vibrato, distorsión,
// restos de la separación). Aquí se mira el audio de la propia fuente: si al «empezar» la segunda nota la
// energía de esa altura no vuelve a subir, no hubo ataque nuevo y es la misma nota que sigue sonando.
// Medido con las partituras de Brayand (4 nov 2026): APAGADO. En fuentes separadas con rasgueos densos la
// energía casi no baja entre golpes repetidos, así que también unía repeticiones reales: notas acertadas
// 33,1 → 28,3 % (umbral 1,35) y 29,5 % (1,08). Queda para cuando haya una señal de ataque más fiable.
// Puro: corre igual en el worker y en Node.
import { fft } from "./dsp";
import type { RawNote } from "./types";

export const SUSTAIN_OPTS = { on: false, gap: 0.08, rise: 1.35 };
const N = 2048, HOP = 220;

/** Une notas de la misma altura sin ataque nuevo entre ellas. Devuelve una lista nueva. */
export function mergeSustained(notes: RawNote[], audio: Float32Array, sr: number, o = SUSTAIN_OPTS): RawNote[] {
  if (!o.on || notes.length < 2) return notes;
  const ns = notes.map((n) => ({ ...n })).sort((a, b) => a.s - b.s || a.p - b.p);
  // Candidatas: misma altura, la segunda empieza (casi) donde termina la primera
  const byP = new Map<number, number[]>();
  ns.forEach((n, i) => (byP.get(n.p) ?? byP.set(n.p, []).get(n.p)!).push(i));
  const cand: [number, number][] = [];
  for (const idx of byP.values()) for (let k = 1; k < idx.length; k++) {
    const a = ns[idx[k - 1]], b = ns[idx[k]];
    if (b.s - a.e <= o.gap && b.s > a.s + 0.05) cand.push([idx[k - 1], idx[k]]);
  }
  if (!cand.length) return ns;
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const cache = new Map<number, Float32Array>();
  const spec = (frame: number) => {
    let m = cache.get(frame);
    if (m) return m;
    const s0 = frame * HOP - N / 2;
    for (let i = 0; i < N; i++) { re[i] = (audio[s0 + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    m = new Float32Array(N / 2); for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]);
    if (cache.size > 4000) cache.clear();
    cache.set(frame, m);
    return m;
  };
  const band = (frame: number, p: number) => {
    const f0 = 440 * 2 ** ((p - 69) / 12), m = spec(frame);
    let e = 0;
    for (let h = 1; h <= 4; h++) {
      const c = (h * f0 * N) / sr; if (c >= N / 2 - 2) break;
      const k0 = Math.max(1, Math.floor(c * 0.977)), k1 = Math.min(N / 2 - 1, Math.ceil(c * 1.023));
      for (let k = k0; k <= k1; k++) e += m[k] * m[k];
    }
    return e;
  };
  const drop = new Set<number>();
  const target = new Map<number, number>(); // índice unido → índice que lo absorbe
  for (const [ia, ib] of cand) {
    const b = ns[ib];
    const fb = Math.round((b.s * sr) / HOP);
    const pre = (band(fb - 6, b.p) + band(fb - 5, b.p)) / 2;
    const post = Math.max(band(fb + 2, b.p), band(fb + 3, b.p), band(fb + 4, b.p), band(fb + 5, b.p));
    if (pre > 0 && post / pre < o.rise) {
      let r = ia; while (target.has(r)) r = target.get(r)!;
      ns[r].e = Math.max(ns[r].e, b.e); ns[r].a = Math.max(ns[r].a, b.a);
      if (b.fx?.length) ns[r].fx = [...new Set([...(ns[r].fx ?? []), ...b.fx])];
      drop.add(ib); target.set(ib, r);
    }
  }
  return ns.filter((_, i) => !drop.has(i));
}
