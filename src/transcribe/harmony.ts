// Armonía: tonalidad (perfiles de Krumhansl-Kessler), cromagrama por tiempo y reconocimiento de
// acordes con plantillas + bajo + tonalidad, suavizado con Viterbi (los acordes cambian sobre todo
// al inicio del compás). Algoritmo propio; puro, para correr en un worker.
import type { ChordSeg, KeyInfo, RawNote } from "./types";

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const ES_SHARP = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"];
const ES_FLAT = ["Do", "Re♭", "Re", "Mi♭", "Mi", "Fa", "Sol♭", "Sol", "La♭", "La", "Si♭", "Si"];
const mod12 = (x: number) => ((x % 12) + 12) % 12;
export const spell = (pc: number, flats: boolean) => (flats ? FLAT : SHARP)[mod12(pc)];

// ---------- tonalidad ----------
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Armadura de cada tónica mayor (Do, Re♭, Re, Mi♭, Mi, Fa, Fa♯, Sol, La♭, La, Si♭, Si). */
const MAJ_SIG = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function pearson(a: number[], b: number[]) {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
}

/** Tonalidad a partir de un histograma de clases de altura (12 valores, peso por duración). */
export function detectKey(hist: number[]): KeyInfo {
  const scores: { tonic: number; mode: "major" | "minor"; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = Array.from({ length: 12 }, (_, i) => hist[mod12(i + t)]);
    scores.push({ tonic: t, mode: "major", r: pearson(rot, KK_MAJ) });
    scores.push({ tonic: t, mode: "minor", r: pearson(rot, KK_MIN) });
  }
  scores.sort((a, b) => b.r - a.r);
  const best = scores[0], next = scores[1];
  const sig = best.mode === "major" ? MAJ_SIG[best.tonic] : MAJ_SIG[mod12(best.tonic + 3)];
  const flats = sig < 0;
  const conf = Math.max(0, Math.min(1, (best.r - next.r) * 4 + best.r * 0.5));
  return { tonic: best.tonic, mode: best.mode, sig, conf, name: `${(flats ? ES_FLAT : ES_SHARP)[best.tonic]} ${best.mode === "major" ? "mayor" : "menor"}` };
}

/** Notas de la escala de la tonalidad (para premiar los acordes diatónicos). */
export function scalePcs(key: KeyInfo): Set<number> {
  const steps = key.mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11]; // menor con sensible
  return new Set(steps.map((s) => mod12(key.tonic + s)));
}

// ---------- cromagrama ----------
/**
 * Cromagrama por tiempo a partir de notas: cada nota suma (traslape en segundos × fuerza) a su clase.
 * También devuelve el cromagrama del registro grave (bajo), que pesa para encontrar la fundamental.
 */
export function beatChroma(notes: RawNote[], beats: number[]): { chroma: number[][]; bass: number[][]; energy: number[] } {
  const B = beats.length;
  const chroma = Array.from({ length: B }, () => new Array(12).fill(0));
  const bass = Array.from({ length: B }, () => new Array(12).fill(0));
  const energy = new Array(B).fill(0);
  const edges = beats.concat([beats[B - 1] + (B > 1 ? beats[B - 1] - beats[B - 2] : 0.5)]);
  // Las notas vienen ordenadas por inicio; se recorre cada tiempo con dos punteros.
  const sorted = notes.slice().sort((a, b) => a.s - b.s);
  let lo = 0;
  for (let k = 0; k < B; k++) {
    const a = edges[k], b = edges[k + 1];
    while (lo < sorted.length && sorted[lo].e < a - 4) lo++; // notas de más de 4 s ya no aportan aquí
    // La armonía de un tiempo la define lo que suena en su primera mitad (pesa más el ataque).
    for (let i = lo; i < sorted.length && sorted[i].s < b; i++) {
      const n = sorted[i];
      const ov = Math.min(b, n.e) - Math.max(a, n.s);
      if (ov <= 0) continue;
      const attack = n.s >= a - 0.03 ? 1.5 : 1;
      const w = (ov / (b - a)) * (0.3 + n.a) * attack;
      chroma[k][mod12(n.p)] += w;
      energy[k] += w;
      if (n.p < 55) bass[k][mod12(n.p)] += w * (n.p < 48 ? 1.5 : 1);
    }
  }
  return { chroma, bass, energy };
}

// ---------- acordes ----------
interface CType { k: string; iv: number[]; w: number[]; prior: number; q: "M" | "m" | "d" | "a" | "s" | "5" }
export const CHORD_TYPES: CType[] = [
  { k: "", iv: [0, 4, 7], w: [1, 0.8, 0.9], prior: 0, q: "M" },
  { k: "m", iv: [0, 3, 7], w: [1, 0.8, 0.9], prior: 0, q: "m" },
  { k: "7", iv: [0, 4, 7, 10], w: [1, 0.8, 0.8, 0.7], prior: -0.035, q: "M" },
  { k: "maj7", iv: [0, 4, 7, 11], w: [1, 0.8, 0.8, 0.7], prior: -0.045, q: "M" },
  { k: "m7", iv: [0, 3, 7, 10], w: [1, 0.8, 0.8, 0.7], prior: -0.04, q: "m" },
  { k: "dim", iv: [0, 3, 6], w: [1, 0.8, 0.9], prior: -0.1, q: "d" },
  { k: "m7b5", iv: [0, 3, 6, 10], w: [1, 0.8, 0.9, 0.7], prior: -0.09, q: "d" },
  { k: "aug", iv: [0, 4, 8], w: [1, 0.8, 0.9], prior: -0.13, q: "a" },
  { k: "sus4", iv: [0, 5, 7], w: [1, 0.8, 0.9], prior: -0.065, q: "s" },
  { k: "sus2", iv: [0, 2, 7], w: [1, 0.8, 0.9], prior: -0.07, q: "s" },
  { k: "5", iv: [0, 7], w: [1, 0.95], prior: -0.07, q: "5" },
];

/** Ajustes del reconocedor (medidos con los acordes escritos en las partituras de Brayand). */
export const HARM_OPTS = { bassRoot: 0.12, bassTone: 0.02, bassOther: -0.06, inKey: 0.04, outKey: 0.02, pen: 0.08, penVar: 0.22, sqrt: true, ext: false };
/** Acordes extendidos: se reconocen para no confundir la raíz (p. ej. Em9 con G); se nombran por su tríada. */
export const EXT_TYPES: CType[] = [
  { k: "6", iv: [0, 4, 7, 9], w: [1, 0.8, 0.8, 0.6], prior: -0.06, q: "M" },
  { k: "m6", iv: [0, 3, 7, 9], w: [1, 0.8, 0.8, 0.6], prior: -0.07, q: "m" },
  { k: "add9", iv: [0, 2, 4, 7], w: [1, 0.6, 0.8, 0.9], prior: -0.06, q: "M" },
  { k: "madd9", iv: [0, 2, 3, 7], w: [1, 0.6, 0.8, 0.9], prior: -0.065, q: "m" },
  { k: "9", iv: [0, 2, 4, 7, 10], w: [1, 0.55, 0.8, 0.7, 0.7], prior: -0.07, q: "M" },
  { k: "m9", iv: [0, 2, 3, 7, 10], w: [1, 0.55, 0.8, 0.7, 0.7], prior: -0.07, q: "m" },
  { k: "maj9", iv: [0, 2, 4, 7, 11], w: [1, 0.55, 0.8, 0.7, 0.7], prior: -0.075, q: "M" },
  { k: "7sus4", iv: [0, 5, 7, 10], w: [1, 0.8, 0.8, 0.7], prior: -0.08, q: "s" },
];

interface Template { root: number; t: CType; vec: number[]; pcs: Set<number> }
const TEMPLATES: Template[] = [];
export function setExtended(on: boolean) {
  HARM_OPTS.ext = on;
  TEMPLATES.length = 0;
  for (let r = 0; r < 12; r++) for (const t of on ? [...CHORD_TYPES, ...EXT_TYPES] : CHORD_TYPES) addTemplate(r, t);
}
function addTemplate(r: number, t: CType) {
  const v = new Array(12).fill(0);
  t.iv.forEach((iv, i) => (v[mod12(r + iv)] = t.w[i]));
  const n = Math.hypot(...v);
  TEMPLATES.push({ root: r, t, vec: v.map((x) => x / n), pcs: new Set(t.iv.map((iv) => mod12(r + iv))) });
}
for (let r = 0; r < 12; r++) for (const t of CHORD_TYPES) {
  const v = new Array(12).fill(0);
  t.iv.forEach((iv, i) => (v[mod12(r + iv)] = t.w[i]));
  const n = Math.hypot(...v);
  TEMPLATES.push({ root: r, t, vec: v.map((x) => x / n), pcs: new Set(t.iv.map((iv) => mod12(r + iv))) });
}

const unit = (v: number[]) => { const n = Math.hypot(...v); return n > 0 ? v.map((x) => x / n) : v; };

/**
 * Reconoce los acordes tiempo por tiempo. `strength[k]` (0–1) indica qué tan probable es un cambio de
 * acorde en el tiempo k (1 = inicio de compás). Devuelve segmentos de acorde ya fusionados.
 */
export function recognizeChords(chroma: number[][], bass: number[][], energy: number[], key: KeyInfo, strength: number[]): ChordSeg[] {
  const B = chroma.length;
  if (!B) return [];
  const scale = scalePcs(key), flats = key.sig < 0;
  const S = TEMPLATES.length + 1; // + «sin acorde»
  const sortedE = energy.slice().sort((a, b) => a - b);
  const medE = sortedE[Math.floor(sortedE.length / 2)] || 1;
  const emit = (k: number): Float64Array => {
    const out = new Float64Array(S);
    const c = unit(chroma[k].map((x) => (HARM_OPTS.sqrt ? Math.sqrt(x) : x)));
    const bsum = bass[k].reduce((a, b) => a + b, 0);
    const bpc = bsum > 0 ? bass[k].indexOf(Math.max(...bass[k])) : -1;
    TEMPLATES.forEach((tp, i) => {
      let s = 0;
      for (let p = 0; p < 12; p++) s += c[p] * tp.vec[p];
      s += tp.t.prior;
      if (bpc >= 0) s += bpc === tp.root ? HARM_OPTS.bassRoot : tp.pcs.has(bpc) ? HARM_OPTS.bassTone : HARM_OPTS.bassOther;
      // Diatónico a la tonalidad: un pequeño premio por cada nota del acorde dentro de la escala.
      let inKey = 0;
      for (const p of tp.pcs) if (scale.has(p)) inKey++;
      s += inKey === tp.pcs.size ? HARM_OPTS.inKey : -HARM_OPTS.outKey * (tp.pcs.size - inKey);
      out[i] = s;
    });
    // Sin acorde: silencios o tiempos casi vacíos.
    out[S - 1] = energy[k] < medE * 0.12 ? 1 : 0.35;
    return out;
  };
  // Viterbi
  let prev = emit(0);
  const back: Int16Array[] = [];
  for (let k = 1; k < B; k++) {
    const e = emit(k), cur = new Float64Array(S), bk = new Int16Array(S);
    const pen = HARM_OPTS.pen + HARM_OPTS.penVar * (1 - Math.max(0, Math.min(1, strength[k] ?? 0)));
    let bestPrev = 0;
    for (let j = 1; j < S; j++) if (prev[j] > prev[bestPrev]) bestPrev = j;
    for (let i = 0; i < S; i++) {
      const stay = prev[i], move = prev[bestPrev] - pen;
      if (stay >= move) { cur[i] = stay + e[i]; bk[i] = i; } else { cur[i] = move + e[i]; bk[i] = bestPrev; }
    }
    back.push(bk);
    prev = cur;
  }
  let st = 0;
  for (let j = 1; j < S; j++) if (prev[j] > prev[st]) st = j;
  const path = new Array<number>(B);
  path[B - 1] = st;
  for (let k = B - 1; k > 0; k--) { st = back[k - 1][st]; path[k - 1] = st; }
  // Segmentos
  const segs: ChordSeg[] = [];
  for (let k = 0; k < B; k++) {
    const s = path[k];
    if (segs.length && segs[segs.length - 1].b1 === k - 1 && (segs[segs.length - 1] as unknown as { _s: number })._s === s) { segs[segs.length - 1].b1 = k; continue; }
    const tp = s < TEMPLATES.length ? TEMPLATES[s] : null;
    const seg: ChordSeg & { _s?: number } = tp
      ? { b0: k, b1: k, root: tp.root, type: tp.t.k, name: spell(tp.root, flats) + tp.t.k, roman: roman(tp.root, tp.t, key), bass: -1 }
      : { b0: k, b1: k, root: -1, type: "N", name: "N.C.", roman: "—", bass: -1 };
    seg._s = s;
    segs.push(seg);
  }
  // Inversiones: si el bajo dominante del segmento es otra nota del acorde, se nombra «C/E».
  for (const seg of segs) {
    delete (seg as { _s?: number })._s;
    if (seg.root < 0 || !["", "m", "7", "m7", "maj7"].includes(seg.type)) continue; // power chords y sus no se nombran con inversión
    const acc = new Array(12).fill(0);
    for (let k = seg.b0; k <= seg.b1; k++) for (let p = 0; p < 12; p++) acc[p] += bass[k][p];
    const tot = acc.reduce((a, b) => a + b, 0);
    if (!tot) continue;
    const bp = acc.indexOf(Math.max(...acc));
    const t = CHORD_TYPES.find((x) => x.k === seg.type)!;
    if (bp !== seg.root && t.iv.some((iv) => mod12(seg.root + iv) === bp) && acc[bp] > 0.55 * tot) {
      seg.bass = bp;
      seg.name += "/" + spell(bp, flats);
    }
  }
  return segs;
}

/** Grado del acorde en la tonalidad (números romanos; minúscula = acorde menor). */
export function roman(root: number, t: { k: string; q: string }, key: KeyInfo): string {
  const d = mod12(root - key.tonic);
  const map = key.mode === "major"
    ? { 0: "I", 1: "♭II", 2: "II", 3: "♭III", 4: "III", 5: "IV", 6: "♯IV", 7: "V", 8: "♭VI", 9: "VI", 10: "♭VII", 11: "VII" }
    : { 0: "I", 1: "♭II", 2: "II", 3: "III", 4: "♯III", 5: "IV", 6: "♯IV", 7: "V", 8: "VI", 9: "♯VI", 10: "VII", 11: "♯VII" };
  let r = (map as Record<number, string>)[d];
  const low = t.q === "m" || t.q === "d";
  if (low) r = r.replace(/[IV]+/, (m) => m.toLowerCase());
  const suf = t.q === "d" ? (t.k === "m7b5" ? "ø7" : "°") : t.q === "a" ? "+" : t.k === "7" ? "7" : t.k === "maj7" ? "maj7" : t.k === "m7" ? "7" : t.k === "sus4" ? "sus4" : t.k === "sus2" ? "sus2" : t.k === "5" ? "5" : "";
  return r + suf;
}

/** Nombre en español de una nota (con la grafía de la tonalidad). */
export const esName = (pc: number, flats: boolean) => (flats ? ES_FLAT : ES_SHARP)[mod12(pc)];
