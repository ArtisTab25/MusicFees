// Lector de tablaturas en PDF: pruebas con primitivas sintéticas (como las que entrega pdf.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as at from "@coderline/alphatab";
import { readTabs, type PPage, type PText, type PLine } from "../src/omr/pdftab";
import { toAlphaTex } from "../src/omr/totex";

/** Un sistema de tablatura de 6 cuerdas con dos compases; las líneas van cortadas detrás de cada número. */
function page(): PPage {
  const top = 700, sp = 6, x0 = 20, x1 = 420;
  const notes: [number, number, string][] = [[60, 1, "3"], [60, 2, "0"], [120, 5, "12"], [170, 6, "x"], [250, 3, "(5)"], [330, 4, "7"]];
  const texts: PText[] = notes.map(([x, s, f]) => ({ s: f, x: x - 2, y: top - (s - 1) * sp - 2.2, w: 3.5 * f.length, size: 6 }));
  texts.push({ s: "12", x: 300, y: top + 10, w: 6, size: 5 }); // número de compás, fuera del pentagrama
  const lines: PLine[] = [];
  for (let s = 0; s < 6; s++) {
    const y = top - s * sp;
    const holes = notes.filter((n) => n[1] === s + 1).map((n) => n[0]).sort((a, b) => a - b);
    let a = x0;
    for (const h of holes) { lines.push({ x0: a, x1: h - 4, y0: y - 0.3, y1: y + 0.3 }); a = h + 4; }
    lines.push({ x0: a, x1: x1, y0: y - 0.3, y1: y + 0.3 });
  }
  for (const x of [x0, 220, x1]) lines.push({ x0: x - 0.3, x1: x + 0.3, y0: top - 5 * sp, y1: top });
  return { w: 600, h: 800, texts, lines };
}

test("lee cuerdas, trastes, compases y columnas de una tablatura en PDF", () => {
  const r = readTabs([page()]);
  assert.equal(r.strings, 6);
  assert.equal(r.bars.length, 2);
  const key = (b: number) => r.bars[b].columns.map((c) => c.notes.map((n) => `${n.tied ? "-" : ""}${n.fret}.${n.str}`).join(" "));
  assert.deepEqual(key(0), ["3.1 0.2", "12.5", "x.6"]);
  assert.deepEqual(key(1), ["-5.3", "7.4"]);
});

test("la tablatura leída se convierte en alphaTex que alphaTab importa con las mismas alturas", () => {
  const tex = toAlphaTex(readTabs([page()]), { title: "Prueba", tempo: 90 });
  const st = new at.Settings();
  const imp = new at.importer.AlphaTexImporter(); imp.initFromString(tex, st);
  const s = imp.readScore();
  const pitches = s.tracks[0].staves[0].bars[0].voices[0].beats.flatMap((b: any) => b.notes.filter((n: any) => !n.isDead && !n.isTieDestination).map((n: any) => n.realValue));
  assert.deepEqual(pitches.sort((a: number, b: number) => a - b), [57, 59, 67]); // la 12.5 = 45+12, si 0.2 = 59, sol 3.1 = 67
  assert.equal(s.tempo, 90);
});
