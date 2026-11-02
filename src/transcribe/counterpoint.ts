// Contrapunto entre dos voces (por ejemplo melodía y bajo): tipos de movimiento, quintas y octavas
// paralelas, cruces y disonancias en tiempo fuerte con su resolución. Trabaja en tiempos de negra.
import type { CounterpointReport } from "./types";

export interface VNote { q0: number; q1: number; p: number }

const at = (v: VNote[], q: number) => {
  // Búsqueda binaria de la nota que suena en q.
  let lo = 0, hi = v.length - 1, r: VNote | null = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (v[m].q0 <= q + 1e-6) { r = v[m]; lo = m + 1; } else hi = m - 1;
  }
  return r && r.q1 > q + 1e-6 ? r : null;
};

const IV_NAMES: Record<number, string> = { 0: "unísono/8ª", 1: "2ª menor", 2: "2ª mayor", 3: "3ª menor", 4: "3ª mayor", 5: "4ª justa", 6: "tritono", 7: "5ª justa", 8: "6ª menor", 9: "6ª mayor", 10: "7ª menor", 11: "7ª mayor" };
export const intervalName = (iv: number) => IV_NAMES[((iv % 12) + 12) % 12];

/** `upper` y `lower`: notas sin encimarse de cada voz. `meter`: tiempos por compás. */
export function analyzeCounterpoint(upper: VNote[], lower: VNote[], meter: number, names: [string, string] = ["Melodía", "Bajo"]): CounterpointReport | null {
  const A = upper.slice().sort((a, b) => a.q0 - b.q0), B = lower.slice().sort((a, b) => a.q0 - b.q0);
  if (A.length < 4 || B.length < 4) return null;
  const times = [...new Set([...A.map((n) => n.q0), ...B.map((n) => n.q0)])].sort((a, b) => a - b);
  const motion = { parallel: 0, similar: 0, contrary: 0, oblique: 0 };
  const parallelPerfect: CounterpointReport["parallelPerfect"] = [];
  const crossings = new Set<number>();
  const ivs = new Map<number, number>();
  let strong = 0, resolved = 0, slices = 0;
  let prev: { a: VNote; b: VNote; q: number } | null = null;
  const strongBeat = (q: number) => {
    const inBar = ((q % meter) + meter) % meter;
    return Math.abs(inBar) < 1e-6 || (meter === 4 && Math.abs(inBar - 2) < 1e-6);
  };
  const dissonant = (iv: number) => [1, 2, 6, 10, 11].includes(((iv % 12) + 12) % 12);
  let pendingDiss: { q: number; a: VNote } | null = null;
  for (const q of times) {
    const a = at(A, q), b = at(B, q);
    if (!a || !b) { prev = null; continue; }
    slices++;
    const iv = a.p - b.p;
    ivs.set(((iv % 12) + 12) % 12, (ivs.get(((iv % 12) + 12) % 12) ?? 0) + 1);
    if (iv < 0) crossings.add(Math.floor(q / meter));
    if (pendingDiss) {
      if (!dissonant(iv) && Math.abs(a.p - pendingDiss.a.p) <= 2) resolved++;
      pendingDiss = null;
    }
    if (strongBeat(q) && dissonant(iv) && (a.q0 === q || b.q0 === q)) { strong++; pendingDiss = { q, a }; }
    if (prev && (prev.a !== a || prev.b !== b)) {
      const dA = a.p - prev.a.p, dB = b.p - prev.b.p;
      if (dA === 0 && dB === 0) { /* misma altura: no hay movimiento */ }
      else if (dA === 0 || dB === 0) motion.oblique++;
      else if (Math.sign(dA) === Math.sign(dB)) {
        const iv0 = prev.a.p - prev.b.p;
        if (iv0 === iv) motion.parallel++; else motion.similar++;
        const pc0 = ((iv0 % 12) + 12) % 12, pc1 = ((iv % 12) + 12) % 12;
        if (pc0 === pc1 && (pc1 === 7 || pc1 === 0)) parallelPerfect.push({ bar: Math.floor(q / meter), kind: pc1 === 7 ? "5as" : "8as" });
      } else motion.contrary++;
    }
    prev = { a, b, q };
  }
  const total = motion.parallel + motion.similar + motion.contrary + motion.oblique || 1;
  const pct = (x: number) => Math.round((x / total) * 100);
  const top = [...ivs].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([iv, n]) => ({ iv, n }));
  const summary: string[] = [];
  summary.push(`Movimiento entre ${names[0].toLowerCase()} y ${names[1].toLowerCase()}: contrario ${pct(motion.contrary)} %, oblicuo ${pct(motion.oblique)} %, directo ${pct(motion.similar)} %, paralelo ${pct(motion.parallel)} %.`);
  if (motion.contrary / total >= 0.3) summary.push("Buen equilibrio: las voces se mueven a menudo en direcciones opuestas, lo que les da independencia.");
  else if (motion.parallel / total >= 0.4) summary.push("Las voces se mueven mucho en paralelo: suenan como una sola línea doblada (típico en rock y pop; en contrapunto clásico se evita).");
  const p5 = parallelPerfect.filter((x) => x.kind === "5as").length, p8 = parallelPerfect.length - p5;
  if (p5 || p8) summary.push(`Quintas paralelas: ${p5} · octavas paralelas: ${p8}${parallelPerfect.length ? ` (compases ${[...new Set(parallelPerfect.map((x) => x.bar + 1))].slice(0, 10).join(", ")})` : ""}.`);
  else summary.push("Sin quintas ni octavas paralelas.");
  if (strong) summary.push(`Disonancias en tiempo fuerte: ${strong}; se resuelven por grado conjunto ${resolved} (${Math.round((resolved / strong) * 100)} %).`);
  if (crossings.size) summary.push(`Las voces se cruzan en ${crossings.size} compás(es).`);
  summary.push(`Intervalos más usados: ${top.map((x) => intervalName(x.iv)).join(", ")}.`);
  return { voices: names, slices, motion, parallelPerfect, crossings: [...crossings].sort((a, b) => a - b), strongDissonances: strong, resolved, intervals: top, summary };
}
