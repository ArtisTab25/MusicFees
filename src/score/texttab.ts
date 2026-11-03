// Tablatura de texto para las pistas que no tienen tablatura en el pentagrama:
// · Batería: una línea por pieza y, en cada golpe, su número General MIDI (36 bombo, 38 caja, 42 hi-hat…).
// · Piano, voz y demás: «tab de teclado», una línea por octava y la letra de cada nota (c d e f g a b; en
//   mayúscula, el sostenido: C = do#).
// Rejilla de semicorcheas (los tresillos y fusas caen en la semicorchea más cercana).
import type * as at from "@coderline/alphatab";
import { kindOf } from "./model";

const DRUM_ORDER = [49, 57, 55, 52, 51, 59, 53, 46, 42, 44, 50, 48, 47, 45, 43, 41, 38, 40, 37, 39, 36, 35];
const DRUM_NAME: Record<number, string> = {
  35: "Bombo 2", 36: "Bombo", 37: "Aro", 38: "Caja", 39: "Palmas", 40: "Caja 2", 41: "Tom piso 2", 42: "HH cerr.", 43: "Tom piso",
  44: "HH pedal", 45: "Tom medio", 46: "HH abier.", 47: "Tom m-a", 48: "Tom alto", 49: "Crash", 50: "Tom alto 2", 51: "Ride", 52: "China",
  53: "Campana", 55: "Splash", 57: "Crash 2", 59: "Ride 2",
};
const LETTER = ["c", "C", "d", "D", "e", "f", "F", "g", "G", "a", "A", "b"];

interface Hit { col: number; key: number; label: string }

function hitsOfBar(track: at.model.Track, bar: at.model.Bar, drums: boolean): { cols: number; hits: Hit[] } {
  const mb = bar.masterBar;
  const ticks = (960 * 4 * mb.timeSignatureNumerator) / mb.timeSignatureDenominator;
  const cols = Math.max(1, Math.round(ticks / 240));
  const hits: Hit[] = [];
  for (const v of bar.voices) for (const b of v.beats) {
    if (b.isRest || !b.notes.length) continue;
    const col = Math.min(cols - 1, Math.round(b.playbackStart / 240));
    for (const n of b.notes) {
      if (n.isTieDestination) continue;
      if (drums) {
        const gm = track.percussionArticulations[n.percussionArticulation]?.outputMidiNumber ?? n.percussionArticulation;
        hits.push({ col, key: gm, label: String(gm) });
      } else {
        const p = n.realValue;
        hits.push({ col, key: Math.floor(p / 12) - 1, label: LETTER[p % 12] });
      }
    }
  }
  return { cols, hits };
}

/** Texto de la tablatura de una pista (batería o instrumento sin tablatura), `perLine` compases por renglón. */
export function textTab(track: at.model.Track, perLine = 2): string {
  const drums = kindOf(track) === "drums";
  const bars = track.staves[0].bars.map((bar) => hitsOfBar(track, bar, drums));
  // Filas: piezas usadas (batería, en orden de platillos a bombo) u octavas usadas (de aguda a grave).
  const used = new Set(bars.flatMap((b) => b.hits.map((h) => h.key)));
  const rows = drums ? [...DRUM_ORDER.filter((k) => used.has(k)), ...[...used].filter((k) => !DRUM_ORDER.includes(k)).sort((a, b) => a - b)] : [...used].sort((a, b) => b - a);
  if (!rows.length) return "(La pista no tiene notas.)";
  const label = (k: number) => (drums ? `${k} ${DRUM_NAME[k] ?? ""}`.trim() : `Octava ${k}`);
  const lw = Math.max(...rows.map((k) => label(k).length));
  // Ancho de cada columna: 2 en batería (números de dos cifras) o el máximo de letras simultáneas.
  const out: string[] = [];
  for (let s = 0; s < bars.length; s += perLine) {
    const chunk = bars.slice(s, s + perLine);
    out.push(`Compás ${s + 1}${chunk.length > 1 ? `–${s + chunk.length}` : ""}`);
    const widths = chunk.map((b) => Array.from({ length: b.cols }, (_, c) => Math.max(drums ? 2 : 1, ...rows.map((k) => b.hits.filter((h) => h.col === c && h.key === k).map((h) => h.label).join("").length))));
    for (const k of rows) {
      let line = label(k).padEnd(lw) + " |";
      chunk.forEach((b, bi) => {
        for (let c = 0; c < b.cols; c++) {
          const txt = b.hits.filter((h) => h.col === c && h.key === k).map((h) => h.label);
          const cell = drums ? (txt[0] ?? "") : txt.join("");
          line += (cell || "").padEnd(widths[bi][c], "-") + "-";
        }
        line += "|";
      });
      out.push(line);
    }
    out.push("");
  }
  const legend = drums
    ? "Cada golpe se escribe con el número General MIDI de su pieza. Rejilla de semicorcheas."
    : "Letra = nota (c d e f g a b); en mayúscula, el sostenido (C = do#, F = fa#). Una línea por octava (4 = la del do central). Rejilla de semicorcheas.";
  return `${track.name}\n${legend}\n\n${out.join("\n")}`;
}
