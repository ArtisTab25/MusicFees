// Saca de cada página de un PDF el texto (con posición) y los trazos rectos, con pdf.js (Apache-2.0).
// Funciona en el navegador y en Node: recibe el módulo de pdf.js ya cargado.
import type { PLine, PPage, PText } from "./pdftab";

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ap = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export async function extractPages(pdfjs: any, data: Uint8Array, maxPages = 40): Promise<PPage[]> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: PPage[] = [];
  const O = pdfjs.OPS;
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const pg = await doc.getPage(p);
    const [vx0, vy0, vx1, vy1] = pg.view;
    const tc = await pg.getTextContent();
    const texts: PText[] = tc.items.filter((i: any) => i.str && i.str.trim()).map((i: any) => ({
      s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.hypot(i.transform[2], i.transform[3]) || Math.hypot(i.transform[0], i.transform[1]),
    }));
    const ops = await pg.getOperatorList();
    const lines: PLine[] = [];
    let ctm: M = [1, 0, 0, 1, 0, 0]; const stack: M[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const f = ops.fnArray[i], a = ops.argsArray[i];
      if (f === O.save) stack.push(ctm);
      else if (f === O.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (f === O.transform) ctm = mul(ctm, a as M);
      else if (f === O.constructPath) {
        // pdf.js ≥ 5: [op de pintura, [datos del trazo], caja]. Datos: 0 moveTo(x,y), 1 lineTo(x,y),
        // 2 curveTo(6), 3 quadraticCurveTo(4), 4 closePath. Cada subtrazo se mide por separado (un mismo
        // trazo puede llevar las 6 líneas de un pentagrama).
        const raw = a?.[1]?.[0] ?? a?.[1];
        const sub: number[][] = []; let cur: number[] = [];
        if (raw && typeof raw.length === "number" && typeof raw[0] === "number") {
          for (let k = 0; k < raw.length;) {
            const op = raw[k++];
            if (op === 0) { if (cur.length) sub.push(cur); cur = [raw[k], raw[k + 1]]; k += 2; }
            else if (op === 1) { cur.push(raw[k], raw[k + 1]); k += 2; }
            else if (op === 2) { cur.push(raw[k + 4], raw[k + 5]); k += 6; }
            else if (op === 3) { cur.push(raw[k + 2], raw[k + 3]); k += 4; }
            else if (op === 4) { /* cierra */ }
            else break;
          }
          if (cur.length) sub.push(cur);
        } else {
          const mm = a[2] as number[] | undefined;
          if (mm && mm.length >= 4 && isFinite(mm[0])) sub.push([mm[0], mm[1], mm[2], mm[3]]);
        }
        for (const pts of sub) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let k = 0; k + 1 < pts.length; k += 2) { const [x, y] = ap(ctm, pts[k], pts[k + 1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          // solo trazos finos (líneas): horizontales o verticales
          if (isFinite(x0) && (y1 - y0 < 2 || x1 - x0 < 2)) lines.push({ x0, x1, y0, y1 });
        }
      }
    }
    pages.push({ w: vx1 - vx0, h: vy1 - vy0, texts, lines });
  }
  return pages;
}
