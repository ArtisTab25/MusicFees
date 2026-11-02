// Estructura de la canción: matriz de autosimilitud por compás (armonía + bajo + intensidad), cortes
// por novedad (kernel de tablero de Foote) ajustados a frases de 4 compases, agrupación de bloques
// que se repiten y nombres por función (Intro, Verso, Coro, Puente, Outro). Algoritmo propio.
import type { FormSection } from "./types";

const cos = (a: number[], b: number[]) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
};

/**
 * `bars[i]` es el vector de rasgos del compás i (crom + bajo); `energy[i]` su intensidad.
 * Devuelve secciones contiguas que cubren todos los compases.
 */
export function findSections(bars: number[][], energy: number[]): FormSection[] {
  const n = bars.length;
  if (!n) return [];
  if (n < 8) return [{ b0: 0, b1: n - 1, label: "A", name: "Tema" }];
  // Autosimilitud
  const S = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => cos(bars[i], bars[j])));
  // Novedad: kernel de tablero de 4+4 compases con ventana gaussiana.
  const L = 4, nov = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    let s = 0, c = 0;
    for (let a = -L; a < L; a++) for (let b = -L; b < L; b++) {
      const x = i + a, y = i + b;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const sign = (a < 0) === (b < 0) ? 1 : -1;
      const g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (L * 0.6) ** 2));
      s += sign * g * S[x][y]; c += g;
    }
    nov[i] = c ? s / c : 0;
  }
  // Cambios de intensidad también marcan secciones.
  const emax = Math.max(1e-9, ...energy);
  for (let i = 1; i < n; i++) {
    const before = avg(energy.slice(Math.max(0, i - 2), i)), after = avg(energy.slice(i, i + 2));
    nov[i] += 0.5 * Math.abs(after - before) / emax;
  }
  // Cortes: picos de novedad, preferentemente cada 4 compases, con bloques de al menos 4 compases.
  const cand = [];
  for (let i = 2; i < n - 2; i++) cand.push({ i, v: nov[i] * (i % 4 === 0 ? 1.25 : i % 2 === 0 ? 1 : 0.7) });
  cand.sort((a, b) => b.v - a.v);
  const mean = avg(nov.slice(1)), sd = Math.sqrt(avg(nov.slice(1).map((v) => (v - mean) ** 2))) || 1e-9;
  const cuts: number[] = [];
  const maxCuts = Math.max(1, Math.round(n / 6));
  for (const c of cand) {
    if (cuts.length >= maxCuts) break;
    if (c.v < mean + 0.25 * sd) break;
    if (cuts.some((x) => Math.abs(x - c.i) < 4)) continue;
    cuts.push(c.i);
  }
  cuts.sort((a, b) => a - b);
  const blocks: { b0: number; b1: number }[] = [];
  let start = 0;
  for (const c of cuts) { if (c - start >= 2) { blocks.push({ b0: start, b1: c - 1 }); start = c; } }
  blocks.push({ b0: start, b1: n - 1 });
  // Agrupar bloques parecidos: se comparan compás a compás alineados desde el inicio.
  const sim = (x: { b0: number; b1: number }, y: { b0: number; b1: number }) => {
    const len = Math.min(x.b1 - x.b0, y.b1 - y.b0) + 1;
    let s = 0;
    for (let k = 0; k < len; k++) s += S[x.b0 + k][y.b0 + k];
    const lenPen = Math.min(x.b1 - x.b0 + 1, y.b1 - y.b0 + 1) / Math.max(x.b1 - x.b0 + 1, y.b1 - y.b0 + 1);
    return (s / len) * (0.75 + 0.25 * lenPen);
  };
  const labels: number[] = [];
  const reps: number[] = []; // bloque representativo de cada etiqueta
  for (let i = 0; i < blocks.length; i++) {
    let best = -1, bv = 0.8;
    reps.forEach((r, li) => { const v = sim(blocks[i], blocks[r]); if (v > bv) { bv = v; best = li; } });
    if (best < 0) { reps.push(i); labels.push(reps.length - 1); } else labels.push(best);
  }
  // Nombres por función
  const count = new Map<number, number>(), en = new Map<number, number>(), firstAt = new Map<number, number>();
  blocks.forEach((b, i) => {
    const l = labels[i];
    count.set(l, (count.get(l) ?? 0) + 1);
    en.set(l, (en.get(l) ?? 0) + avg(energy.slice(b.b0, b.b1 + 1)));
    if (!firstAt.has(l)) firstAt.set(l, i);
  });
  for (const [l, c] of count) en.set(l, en.get(l)! / c);
  const repeated = [...count].filter(([, c]) => c >= 2).map(([l]) => l);
  // Coro: el que se repite con más intensidad; Verso: el otro que se repite y suele ir antes.
  const chorus = repeated.slice().sort((a, b) => en.get(b)! * (count.get(b)! ** 0.3) - en.get(a)! * (count.get(a)! ** 0.3))[0];
  const verse = repeated.filter((l) => l !== chorus).sort((a, b) => firstAt.get(a)! - firstAt.get(b)!)[0];
  const names = new Map<number, string>();
  if (chorus !== undefined) names.set(chorus, "Coro");
  if (verse !== undefined) names.set(verse, firstAt.get(verse)! > firstAt.get(chorus!)! && en.get(verse)! > en.get(chorus!)! ? "Puente" : "Verso");
  let bridge = false;
  const out: FormSection[] = blocks.map((b, i) => {
    const l = labels[i];
    let name = names.get(l);
    if (!name) {
      const unique = count.get(l) === 1, len = b.b1 - b.b0 + 1;
      if (blocks.length === 1) name = "Tema";
      else if (i === 0 && unique && len <= 8) name = "Intro";
      else if (i === blocks.length - 1 && unique) name = "Outro";
      else if (unique && labels[i + 1] === chorus && len <= 8) name = "Pre-coro";
      else if (unique && !bridge && i > blocks.length / 2 && labels.slice(0, i).includes(chorus!)) { name = "Puente"; bridge = true; }
      else name = `Parte ${String.fromCharCode(65 + l)}`;
    }
    return { b0: b.b0, b1: b.b1, label: String.fromCharCode(65 + l), name };
  });
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
