// Convierte la lectura de una tablatura en PDF a alphaTex (el formato de texto de alphaTab), que la app ya
// sabe importar. Cuerdas y trastes vienen exactos del PDF; el ritmo se estima por la posición horizontal de
// cada columna dentro del compás (aproximado: con el audio de la obra se ajusta después).
import type { PPage, TabReading } from "./pdftab";

const TUNINGS: Record<number, string> = {
  4: "g2 d2 a1 e1", 5: "g2 d2 a1 e1 b0", 6: "e4 b3 g3 d3 a2 e2", 7: "e4 b3 g3 d3 a2 e2 b1", 8: "e4 b3 g3 d3 a2 e2 b1 f#1",
};

/** Busca el compás en las cifras SMuFL (U+E080–E089) del primer pentagrama; si no hay, 4/4. */
export function findMeter(pages: PPage[]): [number, number] {
  const pg = pages[0]; if (!pg) return [4, 4];
  const ts = pg.texts.filter((t) => [...t.s].some((c) => c.charCodeAt(0) >= 0xe080 && c.charCodeAt(0) <= 0xe089));
  if (ts.length < 2) return [4, 4];
  const dig = (s: string) => +[...s].map((c) => c.charCodeAt(0) - 0xe080).filter((d) => d >= 0 && d <= 9).join("");
  const first = ts.sort((a, b) => b.y - a.y || a.x - b.x);
  const top = first[0], bot = first.find((t) => t !== top && Math.abs(t.x - top.x) < top.size && t.y < top.y);
  const n = dig(top.s), d = bot ? dig(bot.s) : 4;
  return n > 0 && n <= 16 && [1, 2, 4, 8, 16].includes(d) ? [n, d] : [4, 4];
}

// duraciones en dieciseisavos y su escritura en alphaTex
const DUR: [number, string][] = [[16, "1"], [12, "2{d}"], [8, "2"], [6, "4{d}"], [4, "4"], [3, "8{d}"], [2, "8"], [1, "16"]];
function split(units: number): string[] { const out: string[] = []; let u = units; while (u > 0) { const d = DUR.find(([v]) => v <= u)!; out.push(d[1]); u -= d[0]; } return out; }

export interface TexOpts { title?: string; tempo?: number; meter?: [number, number]; trackName?: string }

export function toAlphaTex(r: TabReading, o: TexOpts = {}): string {
  const [num, den] = o.meter ?? [4, 4];
  const barU = Math.round((num * 16) / den);
  const tuning = TUNINGS[r.strings] ?? TUNINGS[6];
  const bars: string[] = [];
  for (const bar of r.bars) {
    const cols = bar.columns.filter((c) => c.notes.length);
    if (!cols.length) { bars.push(split(barU).map((d) => `r.${d}`).join(" ")); continue; }
    // ataques: posición relativa → rejilla de dieciseisavos, estrictamente creciente
    const on: number[] = [];
    cols.forEach((c, i) => {
      let u = Math.round(c.rel * barU);
      if (i === 0 && c.rel < 0.12) u = 0;
      u = Math.max(u, i ? on[i - 1] + 1 : 0);
      on.push(Math.min(u, barU - (cols.length - i)));
    });
    const beats: string[] = [];
    if (on[0] > 0) beats.push(...split(on[0]).map((d) => `r.${d}`));
    cols.forEach((c, i) => {
      const len = (i + 1 < cols.length ? on[i + 1] : barU) - on[i];
      const parts = split(len);
      const notes = c.notes.map((n) => `${n.tied ? "-" : n.fret === "x" ? "x" : n.fret}.${n.str}`);
      const head = notes.length > 1 ? `(${notes.join(" ")})` : notes[0];
      beats.push(`${head}.${parts[0]}`);
      // lo que sobra de la duración: nota ligada (mismo sonido)
      for (const p of parts.slice(1)) beats.push(`${notes.length > 1 ? `(${c.notes.map((n) => `-.${n.str}`).join(" ")})` : `-.${c.notes[0].str}`}.${p}`);
    });
    bars.push(beats.join(" "));
  }
  const esc = (s: string) => s.replace(/["\\]/g, "");
  return `\\title "${esc(o.title ?? "Tablatura leída de PDF")}" \\tempo ${Math.round(o.tempo ?? 120)}\n` +
    `\\track "${esc(o.trackName ?? (r.strings === 4 || r.strings === 5 ? "Bajo" : "Guitarra"))}" \\staff {tabs} \\tuning (${tuning}) \\ts (${num} ${den})\n` +
    bars.map((b) => b + " |").join("\n") + "\n";
}

/** Tempo escrito («♩ = 120») si aparece en la primera página. */
export function findTempo(pages: PPage[]): number | undefined {
  for (const t of pages[0]?.texts ?? []) { const m = /=\s*(\d{2,3})\b/.exec(t.s); if (m && +m[1] >= 30 && +m[1] <= 300) return +m[1]; }
  return undefined;
}
