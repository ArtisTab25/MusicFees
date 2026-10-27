// Patrones de rasgueo: toman el acorde escrito al inicio de cada compás y lo reparten con un ritmo.
// Se escriben en una rejilla de corcheas: cada letra empieza un golpe y cada «.» alarga el anterior
// (un «.» al inicio es silencio). D = abajo, U = arriba, B = solo el bajo, X = apagado (muteado).
import * as at from "@coderline/alphatab";
import { barCapacity, beatToClip, kindOf, type ClipBeat, type Op } from "./model";

type Score = at.model.Score;

export interface StrumPattern { id: string; name: string; ts: string; grid: string }
export const STRUMS: StrumPattern[] = [
  { id: "rock8", name: "Rock en corcheas", ts: "4/4", grid: "DDDDDDDD" },
  { id: "pop", name: "Pop / folk", ts: "4/4", grid: "D.DU.UDU" },
  { id: "balada", name: "Balada", ts: "4/4", grid: "D.D.D.DU" },
  { id: "reggae", name: "Reggae / ska (contratiempo)", ts: "4/4", grid: ".U.U.U.U" },
  { id: "cumbia", name: "Cumbia", ts: "4/4", grid: "B.DUB.DU" },
  { id: "corrido", name: "Corrido / norteño (bajo y acorde)", ts: "4/4", grid: "B.D.B.D." },
  { id: "polka", name: "Polka / corrido en 2/4", ts: "2/4", grid: "B.D." },
  { id: "vals", name: "Vals / ranchera en 3/4", ts: "3/4", grid: "B.D.D." },
  { id: "funk", name: "Funk (con apagados)", ts: "4/4", grid: "DXDUXUDU" },
  { id: "blancas", name: "Blancas (lento)", ts: "4/4", grid: "D...D..." },
];

const DUR_BY_EIGHTHS: Record<number, [number, number]> = { 1: [8, 0], 2: [4, 0], 3: [4, 1], 4: [2, 0], 6: [2, 1], 8: [1, 0] };

/** Convierte la rejilla en golpes: [símbolo, corcheas que dura]. Un «.» inicial es silencio. */
function hits(grid: string): [string, number][] {
  const out: [string, number][] = [];
  for (const ch of grid) {
    if (ch === "." && out.length) out[out.length - 1][1]++;
    else out.push([ch === "." ? "-" : ch, 1]);
  }
  return out;
}

/** Operaciones para aplicar un patrón a los compases `from`..`to` de la pista `t` (voz 0). */
export function planStrum(score: Score, t: number, from: number, to: number, p: StrumPattern): { ops: Op[]; done: number; skipped: number } {
  const tr = score.tracks[t];
  const ops: Op[] = [];
  let done = 0, skipped = 0;
  if (!tr || kindOf(tr) !== "tab") return { ops, done, skipped: to - from + 1 };
  const [num, den] = p.ts.split("/").map(Number);
  const brushDown = at.model.BrushType.BrushDown, brushUp = at.model.BrushType.BrushUp;
  for (let b = from; b <= to; b++) {
    const mb = score.masterBars[b], bar = tr.staves[0].bars[b];
    if (!mb || !bar) continue;
    // El patrón debe llenar el compás exacto.
    const eighths = (barCapacity(mb) / 480) | 0;
    const chordBeat = bar.voices[0]?.beats.find((x) => x.notes.length > 0);
    if (!chordBeat || mb.timeSignatureNumerator !== num || mb.timeSignatureDenominator !== den || eighths !== p.grid.length) { skipped++; continue; }
    const chord = beatToClip(tr, chordBeat);
    const bass = chord.notes.slice().sort((x, y) => (x.pitch ?? 0) - (y.pitch ?? 0))[0];
    const beats: ClipBeat[] = [];
    const brushes: number[] = [];
    for (const [sym, len] of hits(p.grid)) {
      const [dur, dots] = DUR_BY_EIGHTHS[len] ?? [8, 0];
      if (sym === "-") { beats.push({ dur, dots, tup: 0, notes: [] }); brushes.push(0); continue; }
      const notes = sym === "B" ? (bass ? [{ ...bass, fx: [] as typeof bass.fx }] : [])
        : chord.notes.map((n) => ({ ...n, fx: sym === "X" ? ["dead" as const] : [] }));
      beats.push({ dur, dots, tup: 0, notes });
      brushes.push(sym === "D" ? brushDown : sym === "U" ? brushUp : 0);
    }
    ops.push({ k: "setVoice", t, b, v: 0, beats });
    brushes.forEach((br, i) => { if (br) ops.push({ k: "beatFx", t, b, v: 0, i, fx: "brush", val: br }); });
    done++;
  }
  return { ops, done, skipped };
}
