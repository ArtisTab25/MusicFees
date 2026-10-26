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
