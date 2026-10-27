// Escribir tocando un instrumento MIDI (teclado, guitarra MIDI o pad de batería) conectado por USB
// o Bluetooth. Usa Web MIDI (Chrome, Edge y el WebView de Android). Las notas que llegan juntas
// (menos de 60 ms) forman un acorde en el mismo tiempo; al soltar todas, el cursor avanza.
import type { Editor } from "./editor";

let access: MIDIAccess | null = null;
let held = new Set<number>();
let chord: number[] = [];
let chordT = 0;
let onMsg: ((e: MIDIMessageEvent) => void) | null = null;

export const midiSupported = () => typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
export const midiOn = () => !!access;

/** Conecta todas las entradas MIDI. Devuelve los nombres de los aparatos encontrados. */
export async function startMidi(ed: Editor, say: (m: string) => void): Promise<string[]> {
  if (!midiSupported()) throw new Error("Este navegador no permite instrumentos MIDI. Usa Chrome o la app de Android.");
  access = await navigator.requestMIDIAccess();
  const names: string[] = [];
  onMsg = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 3) return;
    const type = d[0] & 0xf0, note = d[1], vel = d[2];
    if (type === 0x90 && vel > 0) {
      held.add(note);
      const now = performance.now();
      if (now - chordT > 60) chord = [];
      chordT = now;
      chord.push(note);
      const notes = chord.slice();
      // Espera un instante por si llegan más notas del mismo acorde.
      setTimeout(() => { if (chord.length === notes.length && chordT === now) writeChord(ed, notes, say); }, 70);
    } else if (type === 0x80 || (type === 0x90 && vel === 0)) {
      held.delete(note);
      if (!held.size && performance.now() - chordT < 4000) ed.advance();
    }
  };
  for (const input of access.inputs.values()) { input.onmidimessage = onMsg; names.push(input.name ?? "MIDI"); }
  access.onstatechange = () => { for (const input of access!.inputs.values()) input.onmidimessage = onMsg; };
  return names;
}
export function stopMidi() {
  if (!access) return;
  for (const input of access.inputs.values()) input.onmidimessage = null;
  access.onstatechange = null;
  access = null; held = new Set(); chord = [];
}

/** Escribe las notas en el tiempo del cursor según el tipo de pista. */
function writeChord(ed: Editor, notes: number[], say: (m: string) => void) {
  const kind = ed.kind;
  if (kind === "drums") {
    const arts = ed.track.percussionArticulations;
    for (const n of notes) { const idx = arts.findIndex((a) => a.outputMidiNumber === n); if (idx >= 0) ed.togglePerc(idx); }
    return;
  }
  if (kind === "notation") { for (const n of notes) ed.togglePitch(n); return; }
  // Tablatura: cada nota en la cuerda más cómoda, sin repetir cuerda, cerca de la posición actual.
  const st = ed.track.staves[0], tun = st.tuning, nStr = tun.length;
  const used = new Set<number>();
  const cur = ed.noteAtCursor()?.fret ?? 0;
  let placed = 0;
  for (const p of notes.slice().sort((a, b) => b - a)) {
    let best: { row: number; fret: number; cost: number } | null = null;
    for (let row = 0; row < nStr; row++) {
      const s = ed.stringOfRow(row);
      if (used.has(s)) continue;
      const fret = p - tun[nStr - s] - st.capo;
      if (fret < 0 || fret > 24) continue;
      const cost = Math.abs(fret - cur) + (fret > 12 ? 4 : 0);
      if (!best || cost < best.cost) best = { row, fret, cost };
    }
    if (!best) continue;
    used.add(ed.stringOfRow(best.row));
    ed.fretOn(best.row, best.fret);
    placed++;
  }
  if (placed < notes.length) say("Alguna nota no cabe en la afinación de esta pista.");
}
