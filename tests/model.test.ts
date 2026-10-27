import * as at from "@coderline/alphatab";
import { createSong, applyOp, finishScore, toJson, fromJson, rowToString, kindOf, settings, beatTicks, barCapacity, voiceUsed } from "../src/score/model";
import { STYLES } from "../src/score/instruments";
import assert from "node:assert/strict";
import { test } from "node:test";

test("todas las plantillas se crean y exportan a GP7", () => {
  for (const st of STYLES) {
    const s = createSong(st.id, 4, st.name);
    assert.equal(s.tracks.length, st.tracks.length, st.id);
    const gp = new at.exporter.Gp7Exporter().export(s, settings);
    const back = at.importer.ScoreLoader.loadScoreFromBytes(gp, settings);
    assert.equal(back.tracks.length, st.tracks.length);
  }
});

test("edición de tablatura, efectos, dinámica, compases y JSON", () => {
  let s = createSong("hard_rock", 4, "Prueba");
  const tr = s.tracks[0];
  assert.equal(kindOf(tr), "tab");
  const str = rowToString(tr, 5); // fila 5 = cuerda grave
  applyOp(s, { k: "dur", t: 0, b: 0, v: 0, i: 0, dur: 8 });
  applyOp(s, { k: "fret", t: 0, b: 0, v: 0, i: 0, str, fret: 3 });
  applyOp(s, { k: "insBeat", t: 0, b: 0, v: 0, after: 0, dur: 8 });
  applyOp(s, { k: "fret", t: 0, b: 0, v: 0, i: 1, str, fret: 5 });
  applyOp(s, { k: "noteFx", t: 0, b: 0, v: 0, i: 0, str, fx: "hammer", on: true });
  applyOp(s, { k: "noteFx", t: 0, b: 0, v: 0, i: 1, str, fx: "bend", on: true });
  applyOp(s, { k: "beatFx", t: 0, b: 0, v: 0, i: 0, fx: "dynamics", val: 6 });
  applyOp(s, { k: "beatFx", t: 0, b: 0, v: 0, i: 1, fx: "crescendo", val: 1 });
  applyOp(s, { k: "barIns", at: 1 });
  applyOp(s, { k: "barProp", b: 1, prop: "ts", val: "3/4" });
  applyOp(s, { k: "barProp", b: 1, prop: "section", val: "A|Intro" });
  applyOp(s, { k: "barProp", b: 2, prop: "tempo", val: 140 });
  applyOp(s, { k: "trackAdd", preset: "piano" });
  applyOp(s, { k: "pitch", t: 4, b: 0, v: 0, i: 0, pitch: 60, on: true });
  applyOp(s, { k: "pitch", t: 4, b: 0, v: 0, i: 0, pitch: 64, on: true });
  applyOp(s, { k: "perc", t: 3, b: 0, v: 0, i: 0, art: 0, on: true });
  applyOp(s, { k: "chordDef", t: 0, id: "Em", name: "Em", frets: [0, 0, 0, 2, 2, 0] });
  applyOp(s, { k: "beatFx", t: 0, b: 0, v: 0, i: 0, fx: "chord", val: "Em" });
  applyOp(s, { k: "lyrics", t: 0, text: "ho- la mun- do" });
  finishScore(s);
  const b0 = s.tracks[0].staves[0].bars[0].voices[0].beats;
  assert.equal(b0[0].notes[0].realValue, 43); // E2 + 3 = G2
  assert.equal(b0[1].notes[0].fret, 5);
  assert.ok(b0[0].notes[0].isHammerPullOrigin);
  assert.ok(b0[1].notes[0].hasBend);
  assert.equal(s.masterBars.length, 5, "mb");
  assert.equal(s.masterBars[1].timeSignatureNumerator, 3);
  assert.equal(s.tracks[4].staves[0].bars[0].voices[0].beats[0].notes.length, 2);
  assert.equal(s.tracks[4].staves[0].bars.length, 5, "pianobars");
  assert.equal(beatTicks(b0[0]), 480);
  assert.equal(barCapacity(s.masterBars[0]), 3840);
  assert.equal(voiceUsed(s.tracks[0].staves[0].bars[0].voices[0]), 960);
  const json = toJson(s);
  const s2 = fromJson(json);
  assert.equal(s2.tracks.length, 5);
  assert.equal(s2.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].fret, 5);
  assert.equal(s2.masterBars[1].section?.text, "Intro");
  const gp = new at.exporter.Gp7Exporter().export(s2, settings);
  const back = at.importer.ScoreLoader.loadScoreFromBytes(gp, settings);
  assert.equal(back.masterBars.length, 5, "backmb");
  assert.equal(back.tracks[0].staves[0].bars[0].voices[0].beats[0].dynamics, at.model.DynamicValue.FF);
  const mf = new at.midi.MidiFile();
  new at.midi.MidiFileGenerator(s2, settings, new at.midi.AlphaSynthMidiFileHandler(mf, true)).generate();
  assert.ok(mf.toBinary().length > 100);
  applyOp(s, { k: "barDel", at: 1 });
  applyOp(s, { k: "delBeat", t: 0, b: 0, v: 0, i: 1 });
  applyOp(s, { k: "trackDel", t: 4 });
  finishScore(s);
  assert.equal(s.masterBars.length, 4);
  assert.equal(s.tracks.length, 4);
  console.log("json KB", (json.length / 1024).toFixed(1));
});

test("copiar, pegar entre instrumentos, cortar y transponer", async () => {
  const { copy, planPaste, planClear, planTranspose, isWholeBars } = await import("../src/score/clip");
  const s = createSong("blank_gtr", 4, "Clip");
  applyOp(s, { k: "trackAdd", preset: "piano" });
  finishScore(s);
  const low = rowToString(s.tracks[0], 5), g = rowToString(s.tracks[0], 2);
  // Compás 1 de guitarra: cuatro negras (E2+3 = G2, G3 traste 0, silencio, D3+2 = E3)
  const ops = [
    { k: "dur", t: 0, b: 0, v: 0, i: 0, dur: 4 },
    { k: "insBeat", t: 0, b: 0, v: 0, after: 0, dur: 4 },
    { k: "insBeat", t: 0, b: 0, v: 0, after: 1, dur: 4 },
    { k: "insBeat", t: 0, b: 0, v: 0, after: 2, dur: 4 },
    { k: "fret", t: 0, b: 0, v: 0, i: 0, str: low, fret: 3 },
    { k: "fret", t: 0, b: 0, v: 0, i: 1, str: g, fret: 0 },
    { k: "noteFx", t: 0, b: 0, v: 0, i: 1, str: g, fx: "vibrato", on: true },
    { k: "fret", t: 0, b: 0, v: 0, i: 3, str: rowToString(s.tracks[0], 1), fret: 5 },
  ] as const;
  for (const op of ops) applyOp(s, op as never);
  finishScore(s);
  const bar = (t: number, b: number) => s.tracks[t].staves[0].bars[b].voices[0].beats;
  const pitches = (t: number, b: number) => bar(t, b).map((x) => x.notes.map((n) => n.realValue).join("+") || "-").join(" ");
  assert.equal(pitches(0, 0), "43 55 - 64");

  // Compás completo → piano, mismo lugar: mismas alturas, mismo ritmo
  const whole = { t: 0, v: 0, a: { b: 0, i: 0 }, z: { b: 0, i: 3 } };
  assert.ok(isWholeBars(s, whole));
  const clip = copy(s, whole);
  for (const op of planPaste(s, 1, 0, { b: 2, i: 0 }, clip)) applyOp(s, op);
  finishScore(s);
  assert.equal(pitches(1, 2), "43 55 - 64");
  assert.ok(bar(1, 2)[1].notes[0].vibrato > 0, "el vibrato viaja con la nota");

  // Dos tiempos pegados en el último tiempo del compás 2 de guitarra: el segundo pasa al compás 3
  const part = copy(s, { t: 0, v: 0, a: { b: 0, i: 0 }, z: { b: 0, i: 1 } });
  applyOp(s, { k: "dur", t: 0, b: 1, v: 0, i: 0, dur: 2 });
  applyOp(s, { k: "dots", t: 0, b: 1, v: 0, i: 0, n: 1 });
  applyOp(s, { k: "insBeat", t: 0, b: 1, v: 0, after: 0, dur: 4 });
  finishScore(s);
  for (const op of planPaste(s, 0, 0, { b: 1, i: 1 }, part)) applyOp(s, op);
  finishScore(s);
  assert.equal(pitches(0, 1), "- 43");
  assert.equal(pitches(0, 2).split(" ")[0], "55");
  assert.equal(bar(0, 2).reduce((n, x) => n + beatTicks(x), 0), 3840, "el compás 3 queda completo");

  // Transponer +12 en tablatura: cada nota sube una octava sin pasar del traste 24
  for (const op of planTranspose(s, whole, 12).ops) applyOp(s, op);
  finishScore(s);
  assert.equal(pitches(0, 0), "55 67 - 76");
  assert.ok(bar(0, 0).every((x) => x.notes.every((n) => n.fret <= 24)));

  // Cortar: silencios sin perder el ritmo
  for (const op of planClear(s, whole)) applyOp(s, op);
  finishScore(s);
  assert.equal(pitches(0, 0), "- - - -");
  assert.equal(bar(0, 0).length, 4);
  // El resultado se guarda y se exporta
  const back = fromJson(toJson(s));
  assert.equal(back.tracks[1].staves[0].bars[2].voices[0].beats.length, 4);
  new at.exporter.Gp7Exporter().export(back, settings);
});

test("compases de todas las pistas, insertar, borrar y bends", async () => {
  const { copy, planPaste, planDeleteBars } = await import("../src/score/clip");
  const { bendShapeOf } = await import("../src/score/model");
  const s = createSong("hard_rock", 4, "Multi");
  finishScore(s);
  const nT = s.tracks.length;
  const str = rowToString(s.tracks[0], 2);
  applyOp(s, { k: "fret", t: 0, b: 1, v: 0, i: 0, str, fret: 7 });
  applyOp(s, { k: "bend", t: 0, b: 1, v: 0, i: 0, str, shape: "release" });
  finishScore(s);
  assert.equal(bendShapeOf(s.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0]), "release");
  // Copiar el compás 2 de toda la canción e insertarlo antes del compás 1
  const clip = copy(s, { t: 0, v: 0, a: { b: 1, i: 0 }, z: { b: 1, i: 0 }, all: true });
  assert.equal(clip.tracks!.length, nT);
  for (const op of planPaste(s, 0, 0, { b: 0, i: 0 }, clip, true)) applyOp(s, op);
  finishScore(s);
  assert.equal(s.masterBars.length, 5);
  const n0 = s.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  assert.equal(n0.fret, 7);
  assert.equal(bendShapeOf(n0), "release", "el bend viaja con la copia");
  for (const tr of s.tracks) assert.equal(tr.staves[0].bars.length, 5);
  // Borrar dos compases de la canción
  for (const op of planDeleteBars(s, { t: 0, v: 0, a: { b: 3, i: 0 }, z: { b: 4, i: 0 } })) applyOp(s, op);
  finishScore(s);
  assert.equal(s.masterBars.length, 3);
  // Efectos: siguen a su pista al moverla y borrarla
  const { fxMap } = await import("../src/score/model");
  applyOp(s, { k: "trackFx", t: 1, fx: { preset: "bass", drive: 1, low: 6, mid: 5, high: 4, comp: 6, chorus: 0, delay: 0, reverb: 0 } });
  applyOp(s, { k: "trackMove", t: 1, to: 0 });
  assert.equal(fxMap(s)[0]?.preset, "bass");
  applyOp(s, { k: "trackDel", t: 0 });
  assert.equal(Object.keys(fxMap(s)).length, 0);
  const back = fromJson(toJson(s));
  assert.equal(back.masterBars.length, 3);
});

test("tempo por compás, a mitad de compás y gradual", async () => {
  const { tempoAt, tempoChanges } = await import("../src/score/model");
  const s = createSong("blank_gtr", 6, "Tempo");
  applyOp(s, { k: "songProp", prop: "tempo", val: 100 });
  applyOp(s, { k: "tempo", b: 2, list: [{ r: 0, bpm: 140 }, { r: 0.5, bpm: 70 }] });
  applyOp(s, { k: "tempo", b: 3, list: [{ r: 0, bpm: 100 }] });
  finishScore(s);
  assert.equal(tempoAt(s, 1, 0.9), 100);
  assert.equal(tempoAt(s, 2, 0.25), 140);
  assert.equal(tempoAt(s, 2, 0.75), 70);
  assert.equal(tempoAt(s, 4, 0), 100);
  assert.equal(tempoChanges(s).length, 4);
  // El MIDI de alphaTab tarda más en el compás lento: 4 compases de 4/4
  const mf = new at.midi.MidiFile();
  const gen = new at.midi.MidiFileGenerator(s, settings, new at.midi.AlphaSynthMidiFileHandler(mf, true));
  gen.generate();
  const tempos = mf.tracks.flatMap((t) => t.events).filter((e) => e.type === at.midi.MidiEventType.TempoChange || (e as { microSecondsPerQuarterNote?: number }).microSecondsPerQuarterNote);
  assert.ok(tempos.length >= 4, `cambios de tempo en el MIDI: ${tempos.length}`);
  // Quitar los cambios del compás 2 deja el tempo de antes
  applyOp(s, { k: "tempo", b: 2, list: [] });
  assert.equal(tempoAt(s, 2, 0.75), 100);
  // El compás 1 conserva el tempo inicial aunque se pida vaciarlo
  applyOp(s, { k: "tempo", b: 0, list: [] });
  assert.equal(s.tempo, 100);
  assert.equal(fromJson(toJson(s)).masterBars[3].tempoAutomations[0].value, 100);
});

test("pedales y masterizado viajan con la canción", async () => {
  const { fxMap, masterOf } = await import("../src/score/model");
  const s = createSong("blank_gtr", 2, "Fx");
  applyOp(s, { k: "trackFx", t: 0, fx: { preset: "custom", drive: 5, low: 5, mid: 5, high: 5, comp: 0, chorus: 0, delay: 0, reverb: 0, pedals: [{ type: "octave", mix: 5, a: 0, b: 3 }] } });
  applyOp(s, { k: "master", fx: { preset: "rock", low: 6, mid: 5, high: 6, glue: 5, width: 6, loud: 6 } });
  const back = fromJson(toJson(s));
  assert.equal(fxMap(back)[0].pedals?.[0].type, "octave");
  assert.equal(masterOf(back)?.preset, "rock");
  applyOp(back, { k: "master", fx: null });
  assert.equal(masterOf(back), null);
  assert.equal(fxMap(back)[0].drive, 5, "quitar el master no borra los efectos");
});
