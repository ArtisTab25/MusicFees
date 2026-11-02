// Transcripción de batería (algoritmo propio). Sobre la pista de batería ya separada se detecta cada
// golpe y se mide, en cinco bandas, cuánto sube la energía y cuánto tarda en apagarse. Con eso se
// distinguen: bombo, caja, toms (y su altura: de piso, medio, agudo), hi-hat cerrado y abierto, crash
// y ride. Varios pueden sonar juntos (bombo + crash, caja + hi-hat…).
import { bandFlux, logBands, peaks, smooth, stft } from "./dsp";
import type { RawNote } from "./types";

/** Piezas en números General MIDI (los que entiende la batería de MusicFees). */
export const GM = { kick: 36, snare: 38, floorTom: 43, midTom: 45, highTom: 48, hatClosed: 42, hatOpen: 46, crash: 49, ride: 51 } as const;

interface Hit { t: number; v: number; sub: number; low: number; lowmid: number; mid: number; high: number; decHi: number; decLo: number; peakHz: number }

const LAG = 2; // ventana de 2048 con salto de 512: el golpe cae 2 cuadros después del inicio

/** `pcm`: batería separada (mono, 22.05 kHz). */
export function transcribeDrums(pcm: Float32Array, sr: number): RawNote[] {
  const sp = stft(pcm, sr, 2048, 512, 11000);
  const lb = logBands(sp, 96, 30, 11000);
  const mag = lb.mag, fps = sp.fps, C = lb.centers;
  const onset = smooth(bandFlux(mag, C, 30, 11000), 2);
  // Ataques de todo el kit y, aparte, los de los platillos (más suaves, se perdían junto al bombo).
  const on = peaks(onset, fps, 0.05, 0.05, 0.4);
  const hiOn = peaks(smooth(bandFlux(mag, C, 4000, 11000), 2), fps, 0.06, 0.05, 0.4);
  for (const p of hiOn) if (!on.some((q) => Math.abs(q.i - p.i) <= 1)) on.push(p);
  on.sort((a, b) => a.i - b.i);
  const band = (lo: number, hi: number) => C.map((c, k) => (c >= lo && c < hi ? k : -1)).filter((k) => k >= 0);
  const B = { sub: band(35, 90), low: band(90, 200), lowmid: band(200, 500), mid: band(500, 3000), high: band(5000, 11000) };
  const energy = (f: number, ks: number[]) => { let s = 0; for (const k of ks) s += mag[f]?.[k] ?? 0; return s / ks.length; };
  const rise = (i: number, ks: number[]) => {
    let a = 0, b = 0;
    for (let f = i; f <= i + 2; f++) a = Math.max(a, energy(f, ks));
    for (let f = i - 3; f <= i - 1; f++) b += energy(f, ks);
    return Math.max(0, a - b / 3);
  };
  /** Segundos hasta que la banda baja a 35 % de su pico (después del golpe). */
  const decay = (i: number, ks: number[]) => {
    let pk = 0, at = i;
    for (let f = i; f <= i + 3; f++) { const e = energy(f, ks); if (e > pk) { pk = e; at = f; } }
    const floor = energy(Math.max(0, i - 2), ks);
    let f = at;
    while (f < at + 70 && f < mag.length - 1 && energy(f, ks) - floor > 0.35 * (pk - floor)) f++;
    return (f - at) / fps;
  };
  const tomBand = band(70, 400);
  const hits: Hit[] = on.map((p) => {
    const i = p.i;
    let best = tomBand[0], bv = -1;
    for (const k of tomBand) { const r = rise(i, [k]); if (r > bv) { bv = r; best = k; } }
    return { t: (i + LAG) / fps, v: p.v, sub: rise(i, B.sub), low: rise(i, B.low), lowmid: rise(i, B.lowmid), mid: rise(i, B.mid), high: rise(i, B.high), decHi: decay(i, B.high), decLo: decay(i, B.low.concat(B.lowmid)), peakHz: C[best] };
  });
  if (!hits.length) return [];
  // Cada rasgo se compara con los golpes fuertes de esta misma canción.
  const p90 = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length * 0.9)] || 1; };
  const N = { sub: p90(hits.map((h) => h.sub)), low: p90(hits.map((h) => h.low)), lowmid: p90(hits.map((h) => h.lowmid)), mid: p90(hits.map((h) => h.mid)), high: p90(hits.map((h) => h.high)) };
  if ((globalThis as { MF_DEBUG?: boolean }).MF_DEBUG) for (const h of hits) console.log(h.t.toFixed(2), "S", (h.sub / N.sub).toFixed(2), "L", (h.low / N.low).toFixed(2), "LM", (h.lowmid / N.lowmid).toFixed(2), "M", (h.mid / N.mid).toFixed(2), "H", (h.high / N.high).toFixed(2), "dH", h.decHi.toFixed(2), "dL", h.decLo.toFixed(2), "Hz", Math.round(h.peakHz));
  const out: RawNote[] = [];
  const longs: number[] = []; // platillos que se sostienen: hi-hat abierto o ride
  const toms: { h: Hit; a: number }[] = [];
  for (const h of hits) {
    const S = h.sub / N.sub, Lo = h.low / N.low, LM = h.lowmid / N.lowmid, M = h.mid / N.mid, H = h.high / N.high;
    const add = (p: number, a: number) => out.push({ s: h.t, e: h.t + 0.1, p, a: Math.max(0.05, Math.min(1, a)) });
    // Bombo: el golpe vive debajo de ~110 Hz.
    const kick = (S >= 0.5 || (S >= 0.35 && Lo >= 0.5)) && Lo >= 0.2 && (h.peakHz < 115 || S >= 0.35) && S >= 0.45 * LM;
    // Tom: tono claro entre 80 y 350 Hz que tarda en apagarse, con pocos agudos.
    const body = Math.max(LM, Lo);
    const tom = !kick && body >= 0.45 && S < 0.45 * body + 0.15 && h.peakHz >= 75 && h.decLo >= 0.07 && H < 0.65 && M < 1.1 * body + 0.2;
    // Caja: medios con ruido agudo.
    // Con bombo al mismo tiempo, el clic del parche también sube los medios: se pide más.
    const snare = !tom && (kick ? M >= 0.75 && H >= 0.45 && LM >= 0.8 : M >= 0.45 && H >= 0.3) && M >= 0.7 * Math.max(S, LM);
    if (kick) add(GM.kick, Math.max(S, Lo));
    if (tom) toms.push({ h, a: Math.max(LM, Lo) });
    if (snare) add(GM.snare, M);
    // Platillos: por cuánto se sostienen los agudos.
    if (H >= 0.2 && (!snare || h.decHi >= 0.35)) {
      if ((h.decHi >= 0.4 && (H >= 0.7 || M >= 0.5)) || (h.decHi >= 0.28 && H >= 0.9)) add(GM.crash, H);
      else if (h.decHi >= 0.1) longs.push(out.push({ s: h.t, e: h.t + 0.1, p: GM.hatOpen, a: Math.min(1, H) }) - 1);
      else if (!snare) add(GM.hatClosed, H);
    }
  }
  // Ride o hi-hat abierto: el ride se toca seguido (un patrón); el hi-hat abierto, de vez en cuando.
  for (const i of longs) {
    const t = out[i].s;
    const near = longs.filter((j) => Math.abs(out[j].s - t) < 2).length;
    if (near >= 5) out[i].p = GM.ride;
  }
  // Toms: se agrupan por altura (hasta 3) en piso, medio y agudo.
  if (toms.length) {
    const lf = toms.map((x) => Math.log2(x.h.peakHz)).sort((a, b) => a - b);
    const k = toms.length >= 6 ? 3 : toms.length >= 3 ? 2 : 1;
    let cs = Array.from({ length: k }, (_, j) => lf[Math.floor(((j + 0.5) / k) * lf.length)]);
    for (let it = 0; it < 10; it++) {
      const acc = cs.map(() => [0, 0]);
      for (const v of lf) { const j = cs.reduce((b, c, q) => (Math.abs(v - c) < Math.abs(v - cs[b]) ? q : b), 0); acc[j][0] += v; acc[j][1]++; }
      cs = cs.map((c, j) => (acc[j][1] ? acc[j][0] / acc[j][1] : c));
    }
    // Centros a menos de 2 semitonos son el mismo tom.
    cs = cs.filter((c, j) => j === 0 || c - cs[j - 1] > 2 / 12);
    const names = cs.length === 1 ? [GM.midTom] : cs.length === 2 ? [GM.floorTom, GM.highTom] : [GM.floorTom, GM.midTom, GM.highTom];
    for (const x of toms) {
      const v = Math.log2(x.h.peakHz);
      const j = cs.reduce((b, c, q) => (Math.abs(v - c) < Math.abs(v - cs[b]) ? q : b), 0);
      out.push({ s: x.h.t, e: x.h.t + 0.1, p: names[j], a: Math.min(1, x.a) });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}
