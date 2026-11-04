// Lectura de tablaturas en PDF digitales (exportados por Guitar Pro, MuseScore, TuxGuitar, alphaTab…).
// En esos PDF los números de la tablatura son texto con posición exacta y las líneas son trazos: no hace
// falta reconocer imágenes. Aquí, a partir de esas primitivas (texto + segmentos), se encuentran los
// pentagramas de tablatura, las barras de compás y las columnas de notas (cuerda + traste).
// Puro: corre igual en el navegador y en Node (la extracción con pdf.js está en pdfextract.ts).

/** Texto de la página: posición de la línea base (coordenadas de página, y hacia arriba) y tamaño. */
export interface PText { s: string; x: number; y: number; w: number; size: number }
/** Segmento recto (los trazos finos se guardan por su caja). */
export interface PLine { x0: number; x1: number; y0: number; y1: number }
export interface PPage { w: number; h: number; texts: PText[]; lines: PLine[] }

export interface TabNote { str: number; fret: string /* "5", "x" (muerta) */; tied?: boolean /* «(5)»: continuación ligada (o nota fantasma) */ }
export interface TabColumn { x: number; rel: number /* posición dentro del compás, 0..1 */; notes: TabNote[] }
export interface TabBar { columns: TabColumn[] }
export interface TabStaff { page: number; strings: number; top: number; spacing: number; x0: number; x1: number; bars: TabBar[] }
export interface TabReading { staves: TabStaff[]; strings: number; bars: TabBar[]; warnings: string[] }

const FRET = /^\(?(\d{1,2}|x|X)\)?$/;

/** Agrupa los segmentos horizontales en pentagramas (líneas paralelas, equiespaciadas, del mismo ancho). */
export function findStaves(lines: PLine[]): { ys: number[]; x0: number; x1: number; spacing: number }[] {
  const hs = lines.filter((l) => l.y1 - l.y0 < 1.6 && l.x1 - l.x0 > 4)
    .map((l) => ({ y: (l.y0 + l.y1) / 2, x0: l.x0, x1: l.x1 }))
    .sort((a, b) => b.y - a.y || a.x0 - b.x0);
  // une segmentos de la misma línea partidos (un trazo por compás)
  const merged: { y: number; x0: number; x1: number; cov?: number }[] = [];
  // (las líneas de tablatura suelen ir cortadas detrás de cada número: se unen huecos de hasta ~15 pt)
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? merged.splice(0) : hs;
    src.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    for (const h of src) {
      const m = merged.find((q) => Math.abs(q.y - h.y) < 0.5 && h.x0 <= q.x1 + 15 && h.x1 >= q.x0 - 15);
      const len = (h as any).cov ?? h.x1 - h.x0;
      if (m) { m.x0 = Math.min(m.x0, h.x0); m.x1 = Math.max(m.x1, h.x1); m.cov = (m.cov ?? 0) + len; } else merged.push({ ...h, cov: len });
    }
  }
  // las líneas de pentagrama cubren casi todo su largo; las cadenas de líneas adicionales (ledger) no
  for (let i = merged.length - 1; i >= 0; i--) if ((merged[i].cov ?? 0) < 0.55 * (merged[i].x1 - merged[i].x0)) merged.splice(i, 1);
  merged.sort((a, b) => b.y - a.y);
  const out: { ys: number[]; x0: number; x1: number; spacing: number }[] = [];
  const used = new Set<number>();
  const overlap = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) / Math.max(1, Math.max(a.x1 - a.x0, b.x1 - b.x0)); // líneas de casi el mismo largo
  for (let i = 0; i < merged.length; i++) {
    if (used.has(i)) continue;
    const a = merged[i]; const grp = [i];
    let sp = 0;
    for (let j = i + 1; j < merged.length; j++) {
      if (used.has(j)) continue;
      const b = merged[j], last = merged[grp[grp.length - 1]];
      if (overlap(a, b) < 0.7) continue;
      const d = last.y - b.y;
      if (d < 0.5) continue;
      if (!sp) { if (d > 25) break; sp = d; grp.push(j); continue; }
      if (Math.abs(d - sp) < sp * 0.12) grp.push(j); else if (d > sp * 1.12) break;
    }
    if (grp.length >= 4 && Math.min(...grp.map((g) => merged[g].x1 - merged[g].x0)) > 40) {
      grp.forEach((g) => used.add(g));
      const xs0 = grp.map((g) => merged[g].x0), xs1 = grp.map((g) => merged[g].x1);
      out.push({ ys: grp.map((g) => merged[g].y), x0: Math.min(...xs0), x1: Math.max(...xs1), spacing: sp });
    }
  }
  return out;
}

/** Une dígitos sueltos de un mismo número (algunos PDF escriben «1» y «2» por separado para el 12). */
function joinDigits(ts: PText[]): PText[] {
  const s = [...ts].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: PText[] = [];
  for (const t of s) {
    const p = out[out.length - 1];
    if (p && Math.abs(p.y - t.y) < 0.3 && t.x - (p.x + p.w) < t.size * 0.15 && /^\(?\d$/.test(p.s) && /^\d\)?$/.test(t.s)) {
      p.s += t.s; p.w = t.x + t.w - p.x;
    } else out.push({ ...t });
  }
  return out;
}

/** Lee las tablaturas de las páginas. Devuelve compases en orden de lectura con sus columnas de notas. */
export function readTabs(pages: PPage[]): TabReading {
  const warnings: string[] = [];
  const staves: TabStaff[] = [];
  const all = pages.map((pg) => findStaves(pg.lines));
  // espaciado típico de las tablaturas (descarta rejillas de diagramas de acordes y otros adornos)
  // (solo cuentan los pentagramas con números sobre sus líneas: en «partitura + tablatura» hay tantos
  // pentagramas normales como tablaturas)
  const hasFrets = (pg: PPage, s: { ys: number[]; x0: number; x1: number; spacing: number }) => pg.texts.some((t) => {
    if (!FRET.test(t.s.trim()) || t.x < s.x0 || t.x > s.x1) return false;
    const cy = t.y + t.size * 0.36, k = (s.ys[0] - cy) / s.spacing;
    return k > -0.3 && k < s.ys.length - 0.7 && Math.abs(k - Math.round(k)) < 0.25 && t.size < s.spacing * 1.6;
  });
  const sps = pages.flatMap((pg, i) => all[i].filter((s) => hasFrets(pg, s))).map((s) => +s.spacing.toFixed(1));
  const spMode = sps.length ? mode(sps) : 0;
  pages.forEach((pg, pi) => {
    const texts = joinDigits(pg.texts.map((t) => ({ ...t, s: t.s.trim() })).filter((t) => t.s));
    const vert = pg.lines.filter((l) => l.x1 - l.x0 < 2 && l.y1 - l.y0 > 4);
    for (const st of all[pi]) {
      if (Math.abs(st.spacing - spMode) > spMode * 0.04) continue;
      const sp = st.spacing;
      let top = st.ys[0], bot = st.ys[st.ys.length - 1];
      // Las barras de compás cubren el pentagrama completo: corrigen líneas que no se detectaron
      // (en pasajes densos una línea puede quedar toda tapada por números).
      const ext = new Map<string, number>();
      for (const l of vert) {
        if (l.x0 < st.x0 - 2 || l.x1 > st.x1 + 2 || l.y1 < bot - 1 || l.y0 > top + 1) continue;
        if (l.y1 - l.y0 < (st.ys.length - 1) * sp - 1 || l.y1 - l.y0 > 12 * sp) continue;
        const k = `${(l.y0 / sp).toFixed(0)}:${(l.y1 / sp).toFixed(0)}`;
        ext.set(k, (ext.get(k) ?? 0) + 1);
      }
      const best = [...ext.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 2) {
        const ls = vert.filter((l) => `${(l.y0 / sp).toFixed(0)}:${(l.y1 / sp).toFixed(0)}` === best[0]);
        const y1 = ls.reduce((s, l) => s + l.y1, 0) / ls.length, y0 = ls.reduce((s, l) => s + l.y0, 0) / ls.length;
        // se ajusta a la rejilla de las líneas detectadas
        const k1 = Math.round((y1 - top) / sp), k0 = Math.round((bot - y0) / sp);
        if (k1 >= 0 && k1 <= 3) top += k1 * sp;
        if (k0 >= 0 && k0 <= 3) bot -= k0 * sp;
      }
      const n = Math.round((top - bot) / sp) + 1;
      // números dentro del pentagrama, centrados en una línea
      const notes: { x: number; str: number; fret: string; tied: boolean }[] = [];
      for (const t of texts) {
        if (!FRET.test(t.s) || t.x < st.x0 - 2 || t.x > st.x1 + 2) continue;
        const cy = t.y + t.size * 0.36; // centro vertical aproximado de un dígito
        if (cy > top + sp * 0.5 || cy < bot - sp * 0.5) continue;
        if (t.size > sp * 1.6) continue; // demasiado grande para ser un traste
        const k = (top - cy) / sp, str = Math.round(k);
        if (Math.abs(k - str) > 0.3) continue;
        notes.push({ x: t.x + t.w / 2, str: str + 1, fret: /x/i.test(t.s) ? "x" : t.s.replace(/[()]/g, ""), tied: /^\(/.test(t.s) });
      }
      // ¿es una tablatura? (un pentagrama normal de 5 líneas no tiene números sobre sus líneas)
      if (notes.length < 2) continue;
      // barras de compás: trazos verticales que cubren el pentagrama
      const bars = pg.lines.filter((l) => l.x1 - l.x0 < 2 && l.y0 <= bot + 1 && l.y1 >= top - 1 && l.x0 >= st.x0 - 2 && l.x1 <= st.x1 + 2)
        .map((l) => (l.x0 + l.x1) / 2).sort((a, b) => a - b);
      const bx: number[] = [];
      for (const x of [st.x0, ...bars, st.x1]) if (!bx.length || x - bx[bx.length - 1] > sp * 0.8) bx.push(x); else bx[bx.length - 1] = Math.max(bx[bx.length - 1], x);
      const out: TabBar[] = [];
      for (let b = 0; b + 1 < bx.length; b++) {
        const a0 = bx[b], a1 = bx[b + 1];
        const inBar = notes.filter((q) => q.x > a0 && q.x <= a1).sort((p, q) => p.x - q.x);
        const cols: TabColumn[] = [];
        for (const q of inBar) {
          const c = cols[cols.length - 1];
          if (c && q.x - c.x < sp * 0.7) { if (!c.notes.some((m) => m.str === q.str)) c.notes.push({ str: q.str, fret: q.fret, tied: q.tied }); }
          else cols.push({ x: q.x, rel: 0, notes: [{ str: q.str, fret: q.fret, tied: q.tied }] });
        }
        const L = a1 - a0;
        for (const c of cols) { c.rel = Math.max(0, Math.min(1, (c.x - a0 - sp * 0.6) / Math.max(1, L - sp * 1.2))); c.notes.sort((p, q) => p.str - q.str); }
        if (a1 - a0 > sp * 2) out.push({ columns: cols });
      }
      staves.push({ page: pi, strings: n, top, spacing: sp, x0: st.x0, x1: st.x1, bars: out });
    }
  });
  const strings = staves.length ? mode(staves.map((s) => s.strings)) : 6;
  if (staves.some((s) => s.strings !== strings)) warnings.push("Hay tablaturas con distinto número de cuerdas; se leyó la más común.");
  const bars = staves.filter((s) => s.strings === strings).flatMap((s) => s.bars);
  if (!staves.length) warnings.push("No se encontraron tablaturas con texto (¿es un escaneo? para fotos hace falta el lector de imágenes).");
  return { staves, strings, bars, warnings };
}

function mode(xs: number[]): number { const c = new Map<number, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
