// Reparto de las notas de una mezcla en partes: bajo (la línea más grave), melodía (la línea aguda
// que sobresale) y armonía (lo demás). Más la batería, detectada en la parte percusiva del audio.
import type { RawNote } from "./types";

/** Notas que suenan en el instante t (con tolerancia). */
const soundingAt = (notes: RawNote[], t: number, tol = 0.05) => notes.filter((n) => n.s <= t + tol && n.e > t + tol);

/** Deja una sola nota a la vez: si dos se enciman, la que empieza después corta a la anterior. */
export function monophonic(notes: RawNote[], prefer: "low" | "high"): RawNote[] {
  const sorted = notes.slice().sort((a, b) => a.s - b.s || (prefer === "low" ? a.p - b.p : b.p - a.p));
  const out: RawNote[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(n.s - last.s) < 0.04) {
      // Mismo ataque: se queda la del registro que pide la parte (o la más fuerte si es casi igual).
      const better = prefer === "low" ? n.p < last.p : n.p > last.p;
      if (better) out[out.length - 1] = { ...n };
      continue;
    }
    if (last && last.e > n.s) last.e = n.s;
    out.push({ ...n });
  }
  return out.filter((n) => n.e - n.s > 0.04);
}

/**
 * Separa las notas de una canción completa. El bajo: notas graves que son las más bajas al sonar.
 * La melodía: la línea más aguda, solo si sobresale (más fuerte o separada de los acordes).
 */
export function splitRoles(notes: RawNote[]): { bass: RawNote[]; melody: RawNote[]; harmony: RawNote[] } {
  const sorted = notes.slice().sort((a, b) => a.s - b.s);
  const bassSet = new Set<RawNote>(), melSet = new Set<RawNote>();
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    // Solo se miran las notas cercanas (ordenadas por inicio): ninguna nota dura más de 8 s.
    let a = i; while (a > 0 && sorted[a - 1].s > n.s - 8) a--;
    let b = i; while (b < sorted.length - 1 && sorted[b + 1].s <= n.s + 0.06) b++;
    const around = soundingAt(sorted.slice(a, b + 1), n.s + 0.01, 0.04);
    if (!around.includes(n)) around.push(n);
    const lowest = Math.min(...around.map((x) => x.p)), highest = Math.max(...around.map((x) => x.p));
    if (n.p <= 52 && n.p === lowest) bassSet.add(n);
    else if (n.p >= 57 && n.p === highest && around.length > 1) {
      const next = around.filter((x) => x !== n).map((x) => x.p).sort((a, b) => b - a)[0] ?? 0;
      const amps = around.map((x) => x.a).sort((a, b) => b - a);
      if (n.p - next >= 3 || n.a >= amps[0] - 0.02) melSet.add(n);
    } else if (n.p >= 60 && around.length === 1) melSet.add(n);
  }
  let melody = fixOctaveSpikes(monophonic([...melSet], "high"));
  // Una «melodía» con muy pocas notas o puras notas cortas sueltas no es melodía: vuelve a la armonía.
  const dur = sorted.length ? sorted[sorted.length - 1].e - sorted[0].s : 0;
  if (melody.length < Math.max(8, dur / 6)) { melody = []; melSet.clear(); }
  const bass = monophonic([...bassSet], "low");
  const harmony = sorted.filter((n) => !bassSet.has(n) && !melSet.has(n));
  return { bass, melody, harmony };
}

/**
 * Saltos de octava aislados en una línea (una nota que se dispara ±10 semitonos o más y regresa) casi
 * siempre son el armónico de la nota real: se bajan o suben una octava hacia sus vecinas.
 */
export function fixOctaveSpikes(line: RawNote[]): RawNote[] {
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1].p, n = line[i].p, b = line[i + 1].p;
    if (Math.abs(n - a) >= 10 && Math.abs(n - b) >= 10 && Math.sign(n - a) === Math.sign(n - b)) {
      const fixed = n - 12 * Math.sign(n - a);
      if (Math.abs(fixed - a) + Math.abs(fixed - b) < Math.abs(n - a) + Math.abs(n - b)) line[i] = { ...line[i], p: fixed };
    }
  }
  return line;
}

/**
 * Quita armónicos fantasma: el modelo a veces escucha el 2.º–5.º armónico de una nota fuerte como otra
 * nota (octava, octava + quinta, dos octavas…). Si empieza casi a la vez que su fundamental, es más
 * débil y no dura más, se descarta.
 */
export function removeOvertones(notes: RawNote[]): RawNote[] {
  const sorted = notes.slice().sort((a, b) => a.s - b.s);
  const drop = new Set<RawNote>();
  const ratio: Record<number, number> = { 12: 0.6, 19: 0.85, 24: 0.9, 28: 0.95 };
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    for (let j = i - 1; j >= 0 && n.s - sorted[j].s < 0.06; j--) check(sorted[j], n);
    for (let j = i + 1; j < sorted.length && sorted[j].s - n.s < 0.06; j++) check(sorted[j], n);
  }
  function check(f: RawNote, h: RawNote) {
    const d = h.p - f.p, r = ratio[d];
    if (r && h.a < f.a * r && h.e <= f.e + 0.08) drop.add(h);
  }
  return sorted.filter((n) => !drop.has(n));
}
