// Mide el lector de tablaturas PDF contra el .gp de origen: el PDF lo genera alphaTab a partir del .gp
// (render.cjs) y se compara compás por compás (cuerda + traste de cada columna).
import * as at from "@coderline/alphatab";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";
import { extractPages } from "../../musicfees/src/omr/pdfextract";
import { readTabs } from "../../musicfees/src/omr/pdftab";
const [, , gp, pdf, ti] = process.argv;
const s = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(gp)), new at.Settings());
const tr = s.tracks[+ti]; const st = tr.staves[0];
const tun: number[] = st.tuning.slice();
// verdad: por compás, columnas (inicio del beat) con notas {str (1 = la más aguda), fret}
const truth: { str: number; fret: number }[][][] = st.bars.map((b: any) => {
  const cols = new Map<number, { str: number; fret: number }[]>();
  for (const v of b.voices) for (const beat of v.beats) {
    if (beat.isRest || !beat.notes.length) continue;
    const k = beat.playbackStart;
    const arr = cols.get(k) ?? []; cols.set(k, arr);
    for (const n of beat.notes) { if (n.isTieDestination) continue; arr.push({ str: tun.length - n.string + 1, fret: n.fret }); }
  }
  return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter((v) => v.length);
});
const pages = await extractPages(pdfjs, new Uint8Array(readFileSync(pdf)));
const R = readTabs(pages);
const key = (c: { str: number; fret: any }[]) => c.map((n) => `${n.str}:${n.fret}`).sort().join(" ");
let tp = 0, nt = 0, ne = 0, ntN = 0, neN = 0, tpN = 0, barsOk = 0;
const nb = Math.min(truth.length, R.bars.length);
for (let b = 0; b < Math.max(truth.length, R.bars.length); b++) {
  const T = (truth[b] ?? []).map(key), E = (R.bars[b]?.columns ?? []).map((c) => key(c.notes.filter((n: any) => !n.tied))).filter((k) => k);
  // LCS de columnas
  const L = Array.from({ length: T.length + 1 }, () => new Array(E.length + 1).fill(0));
  for (let i = 1; i <= T.length; i++) for (let j = 1; j <= E.length; j++) L[i][j] = T[i - 1] === E[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
  tp += L[T.length][E.length]; nt += T.length; ne += E.length;
  if (L[T.length][E.length] === T.length && T.length === E.length) barsOk++;
  const tn = new Set((truth[b] ?? []).flatMap((c, i) => c.map((n) => `${n.str}:${n.fret}`)));
  ntN += (truth[b] ?? []).reduce((x, c) => x + c.length, 0); neN += (R.bars[b]?.columns ?? []).reduce((x, c) => x + c.notes.length, 0);
}
console.log(`${gp.split("/").pop()} pista ${ti} (${tr.name}) · compases verdad ${truth.length} leídos ${R.bars.length} · columnas P ${(100 * tp / Math.max(1, ne)).toFixed(1)} R ${(100 * tp / Math.max(1, nt)).toFixed(1)} · compases idénticos ${(100 * barsOk / Math.max(1, truth.length)).toFixed(1)} % · pentagramas ${R.staves.length} cuerdas ${R.strings} ${R.warnings.join(" ")}`);
if (process.env.V) for (let b = +(process.env.B ?? 0); b < +(process.env.B ?? 0) + 8; b++) console.log(b, JSON.stringify((truth[b] ?? []).map(key)), "|", JSON.stringify((R.bars[b]?.columns ?? []).map((c) => key(c.notes.filter((n: any) => !n.tied)))));
