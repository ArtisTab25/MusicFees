// PDF → alphaTex → canción: ¿la canción importada tiene las mismas alturas por compás que el .gp?
import * as at from "@coderline/alphatab";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { pdfToTex } from "../../musicfees/src/omr/index";
const [, , gp, pdf, ti] = process.argv;
const st = new at.Settings();
const s = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(gp)), st);
const r = await pdfToTex(pdfjs, new Uint8Array(readFileSync(pdf)), "prueba");
writeFileSync("/home/claude/omr/out.tex", r.tex);
const imp = new at.importer.AlphaTexImporter(); imp.initFromString(r.tex, st);
const o = imp.readScore();
const pitches = (staff: any) => staff.bars.map((b: any) => b.voices.flatMap((v: any) => v.beats.flatMap((be: any) => be.notes.filter((n: any) => !n.isTieDestination).map((n: any) => n.realValue))).sort((a: number, b: number) => a - b).join(","));
const T = pitches(s.tracks[+ti].staves[0]), E = pitches(o.tracks[0].staves[0]);
let ok = 0; for (let i = 0; i < T.length; i++) if (T[i] === E[i]) ok++;
const nT = s.tracks[+ti].staves[0].bars.reduce((x: number, b: any) => x + b.voices[0].beats.length, 0);
console.log(`compás ${r.meter.join("/")} tempo ${r.tempo} · compases ${E.length}/${T.length} · mismas alturas por compás ${(100 * ok / T.length).toFixed(1)} %`);
