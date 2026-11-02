// Digitación óptima para instrumentos de cuerda (algoritmo propio): para cada acorde o nota se buscan
// todas las posiciones tocables (cuerdas distintas, apertura de mano ≤ 4–5 trastes) y se elige la
// secuencia completa con menor esfuerzo por Viterbi: poca apertura, pocos saltos de mano, cuerdas al
// aire en posiciones bajas, sin trastes extremos. También elige la afinación que mejor acomoda la parte.

/** Una nota ya colocada. `str` sigue a alphaTab: 1 = la cuerda más grave. */
export interface Placed { pitch: number; str: number; fret: number }
interface Cand { notes: Placed[]; pos: number; cost: number }

/**
 * `tuning` va de la cuerda aguda a la grave (como en alphaTab). Devuelve, por evento, las notas con
 * cuerda y traste. Las alturas fuera del rango se acomodan por octavas; lo que no cabe se omite.
 */
export function fretEvents(events: number[][], tuning: number[], maxFret = 22): { placed: Placed[][]; cost: number; dropped: number } {
  const S = tuning.length;
  const open = (s: number) => tuning[S - s]; // s = 1 … S, 1 = grave
  const low = Math.min(...tuning), high = Math.max(...tuning) + maxFret;
  let dropped = 0;
  const cands: Cand[][] = events.map((ev) => {
    if (!ev.length) return [];
    // Rango: se sube o baja por octavas lo que no cabe; se quitan duplicados.
    let ps = [...new Set(ev.map((p) => { while (p < low) p += 12; while (p > high) p -= 12; return p; }))].sort((a, b) => b - a);
    if (ps.length > S) { dropped += ps.length - S; ps = reduce(ps, S); }
    let list = enumerate(ps, S, open, maxFret);
    // Acorde imposible: se quitan duplicados de octava y luego notas interiores hasta que se pueda.
    while (!list.length && ps.length > 1) {
      const pcs = new Set<number>(); const keep: number[] = [];
      for (const p of ps) { if (pcs.has(p % 12) && p !== ps[0] && p !== ps[ps.length - 1]) continue; pcs.add(p % 12); keep.push(p); }
      ps = keep.length < ps.length ? keep : ps.filter((_, i) => i !== Math.floor(ps.length / 2));
      dropped++;
      list = enumerate(ps, S, open, maxFret);
    }
    return list.sort((a, b) => a.cost - b.cost).slice(0, 24);
  });
  // Viterbi sobre los eventos con notas (los silencios no mueven la mano).
  const idx = cands.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  const placed: Placed[][] = events.map(() => []);
  if (!idx.length) return { placed, cost: 0, dropped };
  let prevCost = cands[idx[0]].map((c) => c.cost);
  const backs: Int16Array[] = [];
  for (let k = 1; k < idx.length; k++) {
    const A = cands[idx[k - 1]], Bc = cands[idx[k]];
    const cur = new Array<number>(Bc.length), bk = new Int16Array(Bc.length);
    Bc.forEach((b, j) => {
      let best = Infinity, bi = 0;
      A.forEach((a, i) => { const v = prevCost[i] + move(a, b); if (v < best) { best = v; bi = i; } });
      cur[j] = best + b.cost; bk[j] = bi;
    });
    backs.push(bk);
    prevCost = cur;
  }
  let j = prevCost.indexOf(Math.min(...prevCost));
  const total = prevCost[j];
  for (let k = idx.length - 1; k >= 0; k--) {
    placed[idx[k]] = cands[idx[k]][j].notes;
    if (k > 0) j = backs[k - 1][j];
  }
  return { placed, cost: total, dropped };
}

/** Si el acorde trae más notas que cuerdas: conserva la más aguda, la más grave y las demás por clase distinta. */
function reduce(ps: number[], S: number): number[] {
  const keep = [ps[0], ps[ps.length - 1]];
  const pcs = new Set(keep.map((p) => p % 12));
  for (const p of ps.slice(1, -1)) if (keep.length < S && !pcs.has(p % 12)) { keep.push(p); pcs.add(p % 12); }
  for (const p of ps.slice(1, -1)) if (keep.length < S && !keep.includes(p)) keep.push(p);
  return keep.sort((a, b) => b - a);
}

function enumerate(ps: number[], S: number, open: (s: number) => number, maxFret: number): Cand[] {
  const out: Cand[] = [];
  const used = new Set<number>();
  const cur: Placed[] = [];
  const rec = (i: number) => {
    if (out.length > 200) return;
    if (i === ps.length) {
      const fr = cur.filter((n) => n.fret > 0).map((n) => n.fret);
      const mn = fr.length ? Math.min(...fr) : 0, mx = fr.length ? Math.max(...fr) : 0;
      if (mx - mn > (mn >= 7 ? 5 : 4)) return;
      const opens = cur.length - fr.length;
      const strs = cur.map((n) => n.str).sort((a, b) => a - b);
      let skips = 0;
      for (let k = 1; k < strs.length; k++) skips += strs[k] - strs[k - 1] - 1;
      let cost = 0.035 * mn + 0.3 * (mx - mn) + (mn >= 5 && opens ? 0.7 : 0) - (mn <= 3 ? 0.1 * opens : 0) + 0.15 * skips;
      for (const f of fr) if (f > 15) cost += 0.12 * (f - 15);
      if (fr.length > 4) cost += 0.25 * (fr.length - 4); // más de 4 dedos: hace falta cejilla
      out.push({ notes: cur.map((n) => ({ ...n })), pos: fr.length ? mn : -1, cost });
      return;
    }
    const p = ps[i];
    for (let s = 1; s <= S; s++) {
      if (used.has(s)) continue;
      const f = p - open(s);
      if (f < 0 || f > maxFret) continue;
      // Las notas van de aguda a grave: cada una en una cuerda más grave que la anterior.
      if (cur.length && s > cur[cur.length - 1].str) continue;
      used.add(s); cur.push({ pitch: p, str: s, fret: f });
      rec(i + 1);
      cur.pop(); used.delete(s);
    }
  };
  rec(0);
  return out;
}

/** Esfuerzo de pasar de una posición a otra. */
function move(a: Cand, b: Cand): number {
  if (a.pos < 0 || b.pos < 0) return 0; // cuerdas al aire: la mano queda libre
  const d = Math.abs(a.pos - b.pos);
  let c = 0.12 * d + (d > 5 ? 0.5 : 0);
  // Una misma nota repetida se toca en la misma cuerda.
  if (a.notes.length === 1 && b.notes.length === 1 && a.notes[0].pitch === b.notes[0].pitch && a.notes[0].str !== b.notes[0].str) c += 0.3;
  return c;
}

/** Elige la afinación (de las dadas) que deja la parte más cómoda; la estándar va primero. */
export function chooseTuning(events: number[][], options: { id: string; strings: number[] }[], maxFret = 22): { id: string; strings: number[] } {
  const lowest = Math.min(...events.flat(), 127);
  let best = options[0], bestCost = Infinity;
  options.forEach((o, i) => {
    const r = fretEvents(events, o.strings, maxFret);
    // Notas por debajo de la cuerda más grave se subirían de octava: eso cuesta mucho.
    const below = events.flat().filter((p) => p < Math.min(...o.strings)).length;
    const cost = r.cost + below * 2 + r.dropped * 1.5 + (i === 0 ? 0 : 0.02 * events.length + 2);
    if (cost < bestCost && (i === 0 || lowest >= Math.min(...o.strings) - 0)) { bestCost = cost; best = o; }
  });
  return best;
}
