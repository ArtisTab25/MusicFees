import "./styles.css";
import * as at from "@coderline/alphatab";
import { Engine } from "./player/engine";
import { Editor } from "./editor/editor";
import { KeyInput } from "./editor/keys";
import { createSong, fromJson, toJson, finishScore, kindOf, fxMap, masterOf } from "./score/model";
import { Cloud, LiveSession, clientId, loadLocalDoc, localList, rememberSong, saveLocalDoc, type Peer } from "./collab/cloud";
import { ClaudeLibrary } from "./collab/claudeLib";
import { addVersion, clearPending, markPending, pendingSince } from "./collab/vault";
import { h, $, icon, onLongPress } from "./ui/dom";
import { ARTIFACT, NO_CLOUD_MSG, PUBLIC_URL } from "./config";
import { Capacitor } from "@capacitor/core";
import { buildPalettes } from "./ui/palettes";
import { Sheets } from "./ui/sheets";
import { midiName, pcName } from "./score/chords";
import { DRUM_PIECES, LATIN_PIECES } from "./score/instruments";
import { BANKS, BUILTIN_URL, bankById, type Bank } from "./player/banks";
import { downloadPack, getPack, hasPack } from "./player/downloads";
import { adaptForAlphaTab } from "../scripts/sfadapt.mjs";
import { buildKeypad } from "./ui/keypad";

const DUR_GLYPH: Record<number, string> = { 1: "𝅝", 2: "𝅗𝅥", 4: "♩", 8: "♪", 16: "𝅘𝅥𝅯", 32: "𝅘𝅥𝅰", 64: "𝅘𝅥𝅱" };
const DYN = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
const PREFS = (() => { try { return JSON.parse(localStorage.getItem("mf:prefs") || "{}"); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem("mf:prefs", JSON.stringify(PREFS)); } catch { /* sin espacio */ } };

// ---------- estructura ----------
const app = $("#app");
const btnTracks = h("button", { class: "tab tracks", "aria-label": "Pistas y mezclador" }, "Tracks", h("span", { class: "dot" }));
const btnSets = h("button", { class: "tab sets", "aria-label": "Ajustes de canción y pista" }, "Sets");
const btnLogo = h("button", { class: "logo", "aria-label": "Menú de MusicFees" }, h("img", { src: "./icons/icon-192.png", alt: "MusicFees" }));
const titleEl = h("span", { class: "title" }, "Sin título");
const syncEl = h("span", { class: "sync" }, "");
const peersEl = h("span", { class: "peerdot" });
const scoreEl = h("div", { id: "score" });
const cursorEl = h("div", { id: "cursor", hidden: true });
const loadingEl = h("div", { class: "loading" }, "Cargando partitura…");
const scoreWrap = h("main", { id: "scoreWrap", "aria-label": "Partitura" }, scoreEl, cursorEl, loadingEl);
const ctxStrip = h("div", { class: "ctxstrip", "aria-label": "Cuerdas" });
const tools = h("footer", { class: "tools" });
const paletteHost = h("div", { style: "position:relative;z-index:5;flex:none;height:0" });
app.append(
  h("header", { class: "top" }, btnTracks, btnLogo, btnSets),
  h("div", { class: "songline" }, titleEl, peersEl, syncEl),
  scoreWrap, paletteHost, tools,
);
const toastEl = h("div", { id: "toast", role: "status", hidden: true });
document.body.append(toastEl);
let toastT = 0;
export function toast(msg: string, err = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("err", err);
  toastEl.hidden = false;
  clearTimeout(toastT);
  toastT = window.setTimeout(() => (toastEl.hidden = true), err ? 6000 : 2600);
}

// ---------- motor y editor ----------
// Arranca con el banco incluido; si el usuario eligió uno descargado y está guardado, ese.
let bank: Bank = bankById(PREFS.bank);
/** Banco original (lo usa el motor de efectos); alphaTab recibe una copia adaptada. */
let bankOriginal: Uint8Array | null = null;
if (bank.pack) { bankOriginal = await getPack(bank.pack).catch(() => null); if (!bankOriginal) bank = BANKS[0]; }
const forAlphaTab = (b: Uint8Array) => { try { return adaptForAlphaTab(b).bytes; } catch { return b; } };
const startBytes = bankOriginal ? forAlphaTab(bankOriginal) : null;
// En pantallas anchas la partitura arranca más grande (en el celular, 85 %).
const engine = new Engine(scoreEl, scoreWrap, PREFS.zoom ?? (innerWidth >= 900 ? 1.1 : 0.85), startBytes ?? BUILTIN_URL);
// ---------- efectos por pista ----------
const fxTracks = () => {
  const map = fxMap(ed.score);
  return ed.score.tracks.map((t) => ({ index: t.index, channels: [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel], fx: map[t.index] ?? null, mute: t.playbackInfo.isMute, solo: t.playbackInfo.isSolo }));
};
/** Calidad ligera del motor de estudio: automática en teléfonos (o la que elija el usuario). */
const lightAudioPref = () => PREFS.audioQuality === "light" || (PREFS.audioQuality !== "high" && (Capacitor.isNativePlatform() || matchMedia("(pointer: coarse)").matches));
/** Activa o apaga el motor con efectos. Usa el banco elegido, sin la adaptación para alphaTab. */
async function setFx(on: boolean) {
  if (on === !!engine.fx) return;
  if (!on) { engine.disableFx(); PREFS.fx = false; savePrefs(); refresh(); return; }
  syncEl.textContent = "Preparando efectos…";
  try {
    const sf = bankOriginal ?? new Uint8Array(await (await fetch(BUILTIN_URL)).arrayBuffer());
    await engine.enableFx(sf, fxTracks, masterOf(ed.score), lightAudioPref());
    PREFS.fx = true; savePrefs();
    setSync(); refresh();
  } catch (e) { setSync(`No se pudieron activar los efectos: ${(e as Error).message}`, true); }
}
/** Cambia de banco. Si hay que descargarlo, muestra el avance con `onProgress`. */
async function setBank(id: string, onProgress: (pct: number) => void = () => {}) {
  const b = bankById(id);
  if (b.id === bank.id) return;
  if (b.pack) {
    bankOriginal = await downloadPack(b.pack, onProgress);
    engine.setSoundFont(forAlphaTab(bankOriginal));
  } else { bankOriginal = null; engine.setSoundFont(BUILTIN_URL); }
  bank = b; PREFS.bank = b.id; savePrefs();
  toast(`Preparando ${b.name}…`);
  if (engine.fx) { engine.disableFx(); await setFx(true); } // el motor con efectos también cambia de banco
}
if (PREFS.layout === "h") engine.setLayout(false);
engine.hearNotes = PREFS.hearNotes !== false;
const ed = new Editor(createSong("blank_gtr", 8), engine);
const keys = new KeyInput(ed, (m) => toast(m));
const cloud = new Cloud();
/** En el artefacto la biblioteca vive en la cuenta de Claude de cada persona. */
const claudeLib = ARTIFACT ? new ClaudeLibrary() : null;
const isClaudeId = (id: string | null) => !!id && id.startsWith("claude-");
let songId: string | null = null;
let live: LiveSession | null = null;
let isCloud = false;
const peerCursors = new Map<string, { el: HTMLElement; c?: Peer["cursor"]; name: string }>();

// ---------- barra de herramientas ----------
const tb = (iconName: string | null, label: string, onClick: () => void, extra: Record<string, unknown> = {}) =>
  h("button", { class: "tbtn", title: label, "aria-label": label, onclick: onClick, ...extra }, iconName ? icon(iconName, 20) : null, extra.text ? String(extra.text) : null);

const voiceSeg = h("div", { class: "seg", role: "group", "aria-label": "Voz" },
  [0, 1, 2, 3].map((v) => h("button", { "data-v": v, "aria-pressed": v === 0, onclick: () => selectVoice(v) }, String(v + 1))));
const btnView = tb("tracks", "Ver todas las pistas", () => { ed.viewAll = !ed.viewAll; ed.rerender(); refresh(); });
const btnLyrics = tb("mic", "Letra", () => sheets.lyrics(), { text: "Letra" });
const btnChords = tb("grid", "Acordes", () => sheets.chords(), { text: "Acordes" });
const palBtns: Record<string, HTMLButtonElement> = {};
const palDefs: [string, string, string][] = [["bar", "𝄞", "Compás y estructura"], ["note", "♪", "Duración y dinámica"], ["fx", "", "Efectos"], ["text", "", "Texto y acordes"]];
const greens = h("div", { class: "greens" }, palDefs.map(([id, glyph, label]) => {
  const b = h("button", { class: "tbtn music", title: label, "aria-label": label, onclick: () => togglePalette(id) }, glyph || icon(id === "fx" ? "wave" : "grid", 20));
  palBtns[id] = b;
  return b;
}));

const zoomVal = h("span", { class: "zoomv" }, "");
const btnUndo = tb("undo", "Deshacer", () => ed.undo());
const btnRedo = tb("redo", "Rehacer", () => ed.redo());
const btnLayout = tb(PREFS.layout === "h" ? "scroll" : "page", "Vista de página u horizontal", () => {
  PREFS.layout = PREFS.layout === "h" ? "p" : "h"; savePrefs(); engine.setLayout(PREFS.layout !== "h");
  btnLayout.replaceChildren(icon(PREFS.layout === "h" ? "scroll" : "page", 20));
});
// Dos formas de escribir: el teclado propio en pantalla (predeterminado en celular) o el del teléfono.
// Con teclado físico (computadora) se escribe directo en cualquiera de los dos modos.
const coarse = matchMedia("(pointer: coarse)").matches;
let inputMode: "pad" | "kbd" = PREFS.input === "kbd" || PREFS.input === "pad" ? PREFS.input : coarse ? "pad" : "kbd";
const btnPad = tb("keypad", "Teclado de MusicFees", () => {
  if (inputMode === "kbd") setInputMode("pad");
  else showPad(!document.body.classList.contains("pad-on"));
});
const pad = buildKeypad(ed, { hide: () => showPad(false), toast: (m) => toast(m), strums: () => sheets.strumSheet(), lefty: () => PREFS.lefty === true });
function showPad(on: boolean) {
  document.body.classList.toggle("pad-on", on);
  btnPad.setAttribute("aria-pressed", String(on));
  requestAnimationFrame(() => { drawCursor(); scrollToCursor(); });
}
function setInputMode(m: "pad" | "kbd") {
  inputMode = m; PREFS.input = m; savePrefs();
  if (m === "pad") { keys.blur(); showPad(true); } else showPad(false);
}
const btnKbd = tb("keyboard", "Teclado del teléfono", () => {
  if (inputMode === "pad") { setInputMode("kbd"); toast("Teclado del teléfono. Para volver al de MusicFees toca ▦."); }
  keys.focus();
});
const r1 = h("div", { class: "row r1" }, btnPad, btnKbd, voiceSeg, btnView, btnLyrics, btnChords, greens);
const btnCompact = tb("chevronDown", "Ocultar o mostrar filas", () => { document.body.classList.toggle("compact"); PREFS.compact = document.body.classList.contains("compact"); savePrefs(); });
const r2 = h("div", { class: "row r2" },
  tb("home", "Ir al inicio", () => { ed.setCursor({ b: 0, i: 0 }); scoreWrap.scrollTo({ top: 0 }); }),
  btnLayout,
  tb("zoomOut", "Alejar", () => setZoom(-0.1)), zoomVal, tb("zoomIn", "Acercar", () => setZoom(0.1)),
  btnUndo, btnRedo, btnCompact);

const btnCount = tb("countin", "Cuenta antes de tocar", () => { engine.countIn = engine.countIn > 0 ? 0 : 1; refresh(); });
const btnLoop = tb("loop", "Repetir", () => { engine.loop = !engine.loop; refresh(); });
const speedVal = h("span", { class: "zoomv" }, "100%");
const btnMetro = tb("metro", "Metrónomo", () => { engine.metronome = engine.metronome > 0 ? 0 : 1; refresh(); });
const readout = h("span", { class: "readout", "aria-live": "off" });
// El tempo del cursor se toca para cambiarlo.
const tempoBtn = h("button", { class: "tbtn tempo", title: "Cambiar el tempo", "aria-label": "Cambiar el tempo", onclick: () => sheets.tempo() });
const r3 = h("div", { class: "row r3" }, btnCount, btnLoop,
  tb("down", "Más lento", () => setSpeed(-0.1)), speedVal, tb("up", "Más rápido", () => setSpeed(0.1)),
  btnMetro, readout);

const playBtn = h("button", { class: "play", "aria-label": "Reproducir", onclick: () => {
  if (!engine.soundReady) { toast(soundPct < 100 ? `Los sonidos todavía cargan (${soundPct} %). Suena en cuanto terminen.` : "Preparando los sonidos de esta canción…"); pendingPlay = true; return; }
  engine.playPause();
} }, icon("play", 26));
let soundPct = 0, pendingPlay = false;
const chipName = h("span", { class: "nm" });
const chipMeta = h("span", { class: "meta" });
const chip = h("button", { class: "chip", "aria-label": "Pista actual, abrir pistas (mantén presionado para sus opciones)", onclick: () => sheets.tracks() }, chipName, chipMeta);
onLongPress(chip, () => sheets.trackMenu(ed.cursor.t));
ed.onBlocked = (msg) => toast(msg, true);
const transport = h("div", { class: "transport" },
  h("button", { class: "skip", "aria-label": "Compás anterior", onclick: () => jumpBar(-1) }, icon("prev", 28)),
  playBtn,
  h("button", { class: "skip", "aria-label": "Compás siguiente", onclick: () => jumpBar(1) }, icon("next", 28)),
  chip, tempoBtn);
tools.append(ctxStrip, pad.el, r1, r2, r3, transport);
if (PREFS.compact) document.body.classList.add("compact");
if (inputMode === "pad") showPad(true);
// Tocar la barra o la partitura no debe quitarle el foco al campo oculto: en Android el toque
// genera un «mousedown» tardío que lo soltaba y cerraba el teclado justo después de abrirlo.
for (const el of [tools, paletteHost, scoreWrap]) el.addEventListener("mousedown", (e) => {
  if (!(e.target as HTMLElement).closest("input,select,textarea")) e.preventDefault();
});

function setZoom(d: number) {
  const z = Math.max(0.5, Math.min(1.8, Math.round((engine.api.settings.display.scale + d) * 10) / 10));
  PREFS.zoom = z; savePrefs(); engine.setZoom(z); refresh();
}
function setSpeed(d: number) {
  engine.speed = Math.max(0.25, Math.min(2, Math.round((engine.speed + d) * 100) / 100));
  refresh();
}
function selectVoice(v: number) {
  const bar = ed.bar;
  if (bar.voices.length <= v) ed.commit([{ k: "voices", t: ed.cursor.t, n: v + 1 }], { history: false });
  ed.setCursor({ v, i: 0 });
}
function jumpBar(d: number) {
  const n = ed.track.staves[0].bars.length;
  ed.setCursor({ b: Math.max(0, Math.min(n - 1, ed.cursor.b + d)), i: 0 });
  scrollToCursor();
}

// ---------- paletas ----------
const palettes = buildPalettes(ed, { toast, close: () => togglePalette(null), openTempo: () => { togglePalette(null); sheets.tempo(); } });
let openPal: string | null = null;
function togglePalette(id: string | null) {
  openPal = openPal === id ? null : id;
  paletteHost.replaceChildren();
  for (const [k, b] of Object.entries(palBtns)) b.setAttribute("aria-pressed", String(k === openPal));
  if (openPal) paletteHost.append(palettes[openPal]());
}

// ---------- franja de contexto: cuerdas, teclado de piano o kit ----------
function renderCtx() {
  ctxStrip.replaceChildren();
  const tr = ed.track, kind = kindOf(tr), beat = ed.beat;
  if (kind === "tab") {
    const tun = tr.staves[0].tuning;
    tun.forEach((m, row) => {
      const s = ed.stringOfRow(row);
      const n = beat?.notes.find((x) => x.string === s);
      ctxStrip.append(h("button", { class: "sbtn", "aria-pressed": row === ed.cursor.row, "aria-label": `Cuerda ${row + 1}`, onclick: () => { ed.setCursor({ row }); } },
        String(row + 1), h("small", null, n ? `·${n.fret}` : pcName(m))));
    });
  } else if (kind === "notation") {
    ctxStrip.append(h("button", { class: "sbtn", "aria-label": "Octava abajo", onclick: () => { ed.octave = Math.max(0, ed.octave - 1); renderCtx(); } }, "−8"));
    const base = (ed.octave + 1) * 12;
    for (let i = 0; i < 12; i++) {
      const m = base + i, black = [1, 3, 6, 8, 10].includes(i);
      const on = !!beat?.notes.some((n) => n.realValue === m);
      ctxStrip.append(h("button", { class: `pkey${black ? " black" : ""}${on ? " on" : ""}`, "aria-label": midiName(m), onclick: () => ed.togglePitch(m) }, black ? "" : midiName(m)));
    }
    ctxStrip.append(h("button", { class: "sbtn", "aria-label": "Octava arriba", onclick: () => { ed.octave = Math.min(8, ed.octave + 1); renderCtx(); } }, "+8"));
  } else drumPad(tr, beat);
  ctxStrip.classList.toggle("drumpad", kind === "drums");
}

// ---------- batería ----------
// Las pistas importadas de Guitar Pro traen ~95 articulaciones (muchas repetidas: varias cajas,
// cuatro hi-hats…). Se agrupan por sonido: una tecla por pieza, con las que usa la canción primero.
const DRUM_GROUPS: [string, number[]][] = [
  ["Bombo", [36, 35]], ["Caja", [38, 40, 37, 39]], ["Hi-hat", [42, 46, 44]],
  ["Toms", [50, 48, 47, 45, 43, 41]], ["Platillos", [49, 57, 51, 59, 53, 55, 52]],
];
const EXTRA_NAMES: Record<number, string> = { 40: "Caja eléctrica", 41: "Tom de piso grave", 59: "Ride 2", 31: "Baquetas", 33: "Metrónomo", 34: "Campana metrónomo", 58: "Vibraslap", 67: "Agogó agudo", 68: "Agogó grave", 69: "Cabasa", 71: "Silbato corto", 72: "Silbato largo", 76: "Bloque agudo", 77: "Bloque grave", 78: "Cuíca apagada", 79: "Cuíca abierta", 80: "Triángulo apagado", 81: "Triángulo", 82: "Shaker", 83: "Cascabeles", 84: "Campanitas", 85: "Castañuelas", 86: "Surdo apagado", 87: "Surdo" };
let drumMore = false;
function drumPad(tr: at.model.Track, beat: at.model.Beat | null) {
  const names = new Map([...DRUM_PIECES, ...LATIN_PIECES].map((p) => [p.id, p.name]));
  // Cuántas veces usa la canción cada articulación (para elegir la representativa de cada pieza).
  const used = new Map<number, number>();
  for (const bar of tr.staves[0].bars) for (const v of bar.voices) for (const b of v.beats) for (const n of b.notes) used.set(n.percussionArticulation, (used.get(n.percussionArticulation) ?? 0) + 1);
  const byMidi = new Map<number, number>(); // nota MIDI → índice de articulación
  tr.percussionArticulations.forEach((a, idx) => {
    const cur = byMidi.get(a.outputMidiNumber);
    if (cur === undefined || (used.get(idx) ?? 0) > (used.get(cur) ?? 0)) byMidi.set(a.outputMidiNumber, idx);
  });
  const label = (m: number) => names.get(m) ?? EXTRA_NAMES[m] ?? tr.percussionArticulations[byMidi.get(m)!]?.elementType ?? `Nota ${m}`;
  const key = (m: number) => {
    const idx = byMidi.get(m)!;
    const midiOn = !!beat?.notes.some((n) => tr.percussionArticulations[n.percussionArticulation]?.outputMidiNumber === m);
    return h("button", { class: "sbtn dkey", "aria-pressed": midiOn, title: label(m), onclick: () => ed.togglePerc(idx) }, label(m));
  };
  const placed = new Set<number>();
  for (const [group, list] of DRUM_GROUPS) {
    const keys = list.filter((m) => byMidi.has(m));
    if (!keys.length) continue;
    keys.forEach((m) => placed.add(m));
    ctxStrip.append(h("div", { class: "dgroup" }, h("span", null, group), ...keys.map(key)));
  }
  const rest = [...byMidi.keys()].filter((m) => !placed.has(m)).sort((a, b) => (used.get(byMidi.get(b)!) ?? 0) - (used.get(byMidi.get(a)!) ?? 0) || a - b);
  const restUsed = rest.filter((m) => used.has(byMidi.get(m)!));
  const shown = drumMore ? rest : restUsed;
  if (shown.length) ctxStrip.append(h("div", { class: "dgroup" }, h("span", null, "Percusión"), ...shown.map(key)));
  if (rest.length > restUsed.length) ctxStrip.append(h("button", { class: "sbtn dmore", onclick: () => { drumMore = !drumMore; renderCtx(); } }, drumMore ? "Menos piezas" : `Más piezas (${rest.length - restUsed.length})`));
}

// ---------- cursor sobre la partitura ----------
function surfaceOffset() {
  const surf = scoreEl.querySelector(".at-surface") as HTMLElement | null;
  if (!surf) return null;
  const sr = surf.getBoundingClientRect(), wr = scoreWrap.getBoundingClientRect();
  return { x: sr.left - wr.left + scoreWrap.scrollLeft, y: sr.top - wr.top + scoreWrap.scrollTop, surf };
}
function beatBox(t: number, b: number, v: number, i: number, row: number) {
  const bl = engine.bounds, sc = ed.score;
  const beat = sc.tracks[t]?.staves[0]?.bars[b]?.voices[v]?.beats[i];
  if (!bl || !beat) return null;
  const list = bl.findBeats(beat);
  if (!list?.length) return null;
  const st = sc.tracks[t].staves[0], isTab = kindOf(sc.tracks[t]) === "tab" && st.showTablature;
  const bb = isTab ? list[list.length - 1] : list[0];
  const bar = bb.barBounds.realBounds, vb = bb.visualBounds;
  const w = Math.max(16, Math.min(34, vb.w + 6)), x = vb.x + vb.w / 2 - w / 2;
  if (isTab) {
    const n = st.tuning.length, sp = bar.h / Math.max(1, n - 1);
    return { x, y: bar.y + row * sp - sp / 2 - 1, w, h: sp + 2, col: false };
  }
  return { x, y: bar.y - 8, w, h: bar.h + 16, col: true };
}
// Resaltado de la selección: un rectángulo por compás, del primer al último tiempo elegido.
const selLayer = h("div", { class: "sel-layer", "aria-hidden": "true" });
scoreWrap.append(selLayer);
function drawSelection(off: ReturnType<typeof surfaceOffset>) {
  const sel = ed.sel, bl = engine.bounds;
  const boxes: HTMLElement[] = [];
  const shown = sel ? (sel.all ? ed.renderTracks() : ed.renderTracks().filter((t) => t === sel.t)) : [];
  for (const st of shown) if (sel && off && bl) {
    const voiceBeats = (b: number) => ed.score.tracks[st]?.staves[0]?.bars[b]?.voices[sel.all ? 0 : sel.v]?.beats ?? [];
    const s = sel.a.b < sel.z.b || (sel.a.b === sel.z.b && sel.a.i <= sel.z.i) ? sel.a : sel.z;
    const e = s === sel.a ? sel.z : sel.a;
    for (let b = s.b; b <= e.b; b++) {
      const beats = voiceBeats(b);
      const first = beats[b === s.b ? s.i : 0], last = beats[b === e.b ? Math.min(e.i, beats.length - 1) : beats.length - 1];
      const f = first && bl.findBeats(first), l = last && bl.findBeats(last);
      if (!f?.length || !l?.length) continue;
      const top = Math.min(...f.map((x) => x.barBounds.realBounds.y)), bottom = Math.max(...f.map((x) => x.barBounds.realBounds.y + x.barBounds.realBounds.h));
      const x1 = Math.min(...f.map((x) => x.visualBounds.x)) - 4, x2 = Math.max(...l.map((x) => x.visualBounds.x + x.visualBounds.w)) + 4;
      boxes.push(h("div", { class: "sel-box", style: `left:${off.x + x1}px;top:${off.y + top - 6}px;width:${Math.max(12, x2 - x1)}px;height:${bottom - top + 12}px` }));
    }
  }
  selLayer.replaceChildren(...boxes);
}
function drawCursor() {
  const off = surfaceOffset();
  drawSelection(off);
  const c = ed.cursor;
  const box = off && ed.renderTracks().includes(c.t) ? beatBox(c.t, c.b, c.v, c.i, c.row) : null;
  if (!box || !off) { cursorEl.hidden = true; } else {
    Object.assign(cursorEl.style, { left: `${off.x + box.x}px`, top: `${off.y + box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    cursorEl.classList.toggle("col", box.col);
    cursorEl.hidden = false;
  }
  for (const [, pc] of peerCursors) {
    const p = pc.c;
    const bx = off && p && ed.renderTracks().includes(p.t) ? beatBox(p.t, p.b, 0, p.i, p.row) : null;
    if (!bx || !off) { pc.el.hidden = true; continue; }
    Object.assign(pc.el.style, { left: `${off.x + bx.x}px`, top: `${off.y + bx.y}px`, width: `${bx.w}px`, height: `${bx.h}px` });
    pc.el.hidden = false;
  }
}
function scrollToCursor() {
  requestAnimationFrame(() => {
    if (cursorEl.hidden) return;
    const r = cursorEl.getBoundingClientRect(), wr = scoreWrap.getBoundingClientRect();
    if (r.top < wr.top + 10 || r.bottom > wr.bottom - 10) scoreWrap.scrollBy({ top: r.top - wr.top - wr.height / 3, behavior: "smooth" });
    if (r.left < wr.left || r.right > wr.right) scoreWrap.scrollBy({ left: r.left - wr.left - wr.width / 3, behavior: "smooth" });
  });
}

// Tocar la partitura: elige tiempo y cuerda, y abre el teclado.
// Mantener el dedo medio segundo empieza una selección; Mayús + clic la extiende.
let down: { x: number; y: number; t: number; timer: number; done: boolean } | null = null;
function placeAt(clientX: number, clientY: number, mode: "tap" | "extend" | "start") {
  const off = surfaceOffset(), bl = engine.bounds;
  if (!off || !bl) return;
  const wr = scoreWrap.getBoundingClientRect();
  const x = clientX - wr.left + scoreWrap.scrollLeft - off.x, y = clientY - wr.top + scoreWrap.scrollTop - off.y;
  const beat = bl.getBeatAtPos(x, y);
  if (!beat) { if (mode === "tap") openInput(); return; }
  const t = beat.voice.bar.staff.track.index;
  const tr = ed.score.tracks[t];
  let row = ed.cursor.row;
  if (kindOf(tr) === "tab" && tr.staves[0].showTablature) {
    const list = bl.findBeats(beat) ?? [];
    const bb = list[list.length - 1];
    if (bb) {
      const bar = bb.barBounds.realBounds, n = tr.staves[0].tuning.length, sp = bar.h / Math.max(1, n - 1);
      if (y >= bar.y - sp && y <= bar.y + bar.h + sp) row = Math.max(0, Math.min(n - 1, Math.round((y - bar.y) / sp)));
    }
  }
  const to = { t, b: beat.voice.bar.index, v: beat.voice.index, i: beat.index, row };
  if (mode === "start") {
    ed.clearSelection();
    ed.setCursor(to, false, false);
    ed.toggleSelecting(true);
    navigator.vibrate?.(15);
    toast("Selección: toca otro tiempo para extenderla.");
  } else ed.setCursor(to, false, mode === "extend" || ed.selecting);
  // Tocar una nota elige desde dónde suena: en pausa la próxima vez, y si está sonando salta ahí.
  engine.seekBeat(beat);
  if (engine.playing) return; // sonando no se abre el teclado (se tapaba la partitura)
  openInput();
}
scoreWrap.addEventListener("pointerdown", (e) => {
  if (down) clearTimeout(down.timer);
  const d = { x: e.clientX, y: e.clientY, t: Date.now(), timer: 0, done: false };
  if (e.pointerType !== "mouse") d.timer = window.setTimeout(() => { if (down === d) { d.done = true; placeAt(d.x, d.y, "start"); } }, 500);
  down = d;
});
scoreWrap.addEventListener("pointermove", (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { clearTimeout(down.timer); down = null; }
});
scoreWrap.addEventListener("pointercancel", () => { if (down) { clearTimeout(down.timer); down = null; } });
scoreWrap.addEventListener("pointerup", (e) => {
  const d = down;
  down = null;
  if (!d) return;
  clearTimeout(d.timer);
  if (d.done || Date.now() - d.t > 1500 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
  placeAt(e.clientX, e.clientY, e.shiftKey ? "extend" : "tap");
});
/** Tras tocar la partitura: muestra el teclado propio o abre el del teléfono, según el modo. */
function openInput() {
  if (inputMode === "pad") { if (!document.body.classList.contains("pad-on")) showPad(true); }
  else keys.focus();
}

/** Duración aproximada en figuras (♩ = negra). */
function gapText(ticks: number) {
  const q = ticks / 960;
  if (Math.abs(q - Math.round(q)) < 0.01) return `${Math.round(q)} ♩`;
  if (Math.abs(q * 2 - Math.round(q * 2)) < 0.01) return `${Math.round(q * 2)} ♪`;
  return `${Math.round(q * 4)} 𝅘𝅥𝅯`;
}
// ---------- refrescar indicadores ----------
function refresh() {
  const sc = ed.score, tr = ed.track, beat = ed.beat;
  titleEl.textContent = sc.title || "Sin título";
  const idx = ed.cursor.t + 1;
  const kindIcon = kindOf(tr) === "drums" ? "drum" : kindOf(tr) === "notation" ? "piano" : "guitar";
  chipName.replaceChildren(icon(kindIcon, 18), `${idx}. ${tr.name}`);
  const mb = ed.masterBar;
  const tempo = Math.round(ed.tempoHere);
  // Aviso de compás incompleto o con de más (se completa desde el teclado: «Completar»).
  const gap = ed.barGap;
  chipMeta.replaceChildren(
    h("span", null, `${ed.cursor.b + 1}/${sc.masterBars.length}`),
    h("span", { class: engine.soundReady ? "ok" : "" }, `● ${mb.timeSignatureNumerator}:${mb.timeSignatureDenominator}`),
    h("span", null, timeText),
    ...(Math.abs(gap) > 1 && ed.beat && !(ed.bar.voices[ed.cursor.v].beats.length === 1 && ed.beat.isEmpty) ? [h("span", { class: "gap", title: gap > 0 ? "Al compás le falta tiempo" : "Al compás le sobra tiempo" }, gap > 0 ? `falta ${gapText(gap)}` : `sobra ${gapText(-gap)}`)] : []),
  );
  const n = ed.noteAtCursor();
  readout.replaceChildren(
    h("b", null, DUR_GLYPH[beat?.duration ?? 4] ?? "♩"), beat?.dots ? "·" : "",
    h("span", null, DYN[ed.dynamic]),
    h("span", null, n ? (kindOf(tr) === "drums" ? "golpe" : midiName(n.realValue)) : "—"),
  );
  tempoBtn.textContent = `♩ = ${tempo}`;
  zoomVal.textContent = `${Math.round(engine.api.settings.display.scale * 100)}%`;
  speedVal.textContent = `${Math.round(engine.speed * 100)}%`;
  btnUndo.disabled = !ed.canUndo;
  btnRedo.disabled = !ed.canRedo;
  btnView.setAttribute("aria-pressed", String(ed.viewAll));
  btnCount.setAttribute("aria-pressed", String(engine.countIn > 0));
  btnLoop.setAttribute("aria-pressed", String(engine.loop));
  btnMetro.setAttribute("aria-pressed", String(engine.metronome > 0));
  for (const b of Array.from(voiceSeg.children)) b.setAttribute("aria-pressed", String(Number((b as HTMLElement).dataset.v) === ed.cursor.v));
  btnTracks.classList.toggle("live", !!live && live.others.length > 0);
  renderCtx();
  // La barra de selección vive en el teclado propio: se muestra sola mientras haya selección.
  if ((ed.sel || ed.selecting) && !document.body.classList.contains("pad-on")) { showPad(true); padAuto = true; }
  else if (!ed.sel && !ed.selecting && padAuto) { padAuto = false; if (inputMode === "kbd") showPad(false); }
  pad.update();
  drawCursor();
  if (openPal) { const id = openPal; openPal = null; togglePalette(id); }
}
let timeText = "00:00 / 00:00";
let padAuto = false;
scoreWrap.addEventListener("contextmenu", (e) => e.preventDefault());
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
let lastPosPaint = 0;
engine.on("position", (cur, end) => {
  timeText = `${fmt(cur)} / ${fmt(end)}`;
  const now = performance.now();
  if (now - lastPosPaint > 250) { lastPosPaint = now; const spans = chipMeta.querySelectorAll("span"); if (spans[2]) spans[2].textContent = timeText; }
});
engine.on("state", (playing) => { document.body.classList.toggle("playing", playing); });
engine.on("state", (playing) => { playBtn.replaceChildren(icon(playing ? "pause" : "play", 26)); playBtn.setAttribute("aria-label", playing ? "Pausar" : "Reproducir"); });
engine.on("rendered", () => {
  loadingEl.remove(); drawCursor();
  // Al cambiar de pista el cursor de reproducción se quedaba donde estaba en el dibujo anterior.
  if (!engine.playing && ed.beat) engine.seekBeat(ed.beat);
});
engine.on("ready", () => { refresh(); setSync(); if (pendingPlay) { pendingPlay = false; engine.playPause(); } });
engine.on("loadProgress", (p) => { soundPct = p; if (p < 100) syncEl.textContent = `Sonidos ${p} %`; else syncEl.textContent = "Preparando sonidos…"; });
engine.on("beat", (b) => {
  if (!engine.playing) return;
  const bar = b.voice.bar;
  if (b.voice.bar.staff.track.index === ed.cursor.t) {
    ed.setCursor({ b: bar.index, v: b.voice.index, i: b.index }, true);
    drawCursor();
  }
});
ed.onChange(() => { refresh(); scrollToCursor(); sendCursorSoon(); if (!engine.playing) { const b = ed.beat; if (b) engine.seekBeat(b); } });
btnTracks.onclick = () => sheets.tracks();
btnSets.onclick = () => sheets.sets();
btnLogo.onclick = () => sheets.menu();
window.addEventListener("resize", () => drawCursor());

// ---------- guardar y dúo en vivo ----------
let saveLocalT = 0, saveCloudT = 0;
/** Dónde vive la canción abierta (cuando no hay nada pendiente). */
function placeLabel() {
  return isClaudeId(songId) ? "En tu biblioteca de Claude" : ARTIFACT ? "Solo en este navegador" : isCloud ? (live?.connected ? "En la nube · en vivo" : cloud.session ? `Biblioteca de ${cloud.session.username}` : "En la nube") : "Solo en este teléfono";
}
let savedAt = 0;
function setSync(msg?: string, err = false) {
  syncEl.textContent = msg ?? (savedAt ? `✓ Guardado · ${placeLabel()}` : placeLabel());
  syncEl.classList.toggle("err", err);
  syncEl.classList.toggle("dirty", msg === "● Sin guardar");
}
/** Guarda ya en el teléfono (y toma una versión automática cada 10 minutos de edición). */
function saveLocalNow() {
  clearTimeout(saveLocalT);
  if (!songId) return;
  const json = ed.json();
  saveLocalDoc(songId, json);
  rememberSong({ id: songId, title: ed.score.title || "Sin título", updated: Date.now(), cloud: isCloud });
  if (isCloud || isClaudeId(songId)) markPending(songId);
  void addVersion(songId, ed.score.title || "Sin título", json, "", true).catch(() => { /* sin IndexedDB */ });
  if (!isCloud && !isClaudeId(songId)) { savedAt = Date.now(); setSync(); }
}
ed.onDirty = () => {
  setSync("● Sin guardar");
  clearTimeout(saveLocalT);
  saveLocalT = window.setTimeout(() => { saveLocalT = 0; saveLocalNow(); }, 500);
  if (isCloud) scheduleCloudSave();
  if (isClaudeId(songId)) scheduleClaudeSave();
};
let saveClaudeT = 0;
function scheduleClaudeSave(delay = 2000) {
  clearTimeout(saveClaudeT);
  saveClaudeT = window.setTimeout(async () => {
    saveClaudeT = 0;
    if (!claudeLib || !isClaudeId(songId)) return;
    const id = songId!;
    setSync("Guardando…");
    try { await claudeLib.save(id.slice(7), ed.score.title, ed.json()); clearPending(id); savedAt = Date.now(); setSync(); }
    catch (e) { setSync((e as Error).message, true); }
  }, delay);
}
function scheduleCloudSave(delay = 1500) {
  clearTimeout(saveCloudT);
  saveCloudT = window.setTimeout(async () => {
    saveCloudT = 0;
    if (!songId || !isCloud) return;
    if (live && !live.isHost) return; // guarda quien es anfitrión mientras los dos están conectados
    const id = songId;
    setSync("Guardando…");
    try { await cloud.save(id, ed.score.title, ed.json()); clearPending(id); savedAt = Date.now(); setSync(); }
    catch (e) { setSync((e as Error).message, true); }
  }, delay);
}
// Guardar al salir: cuando la app pasa a segundo plano (Android) o se cierra la pestaña.
const flushSaves = () => {
  if (!saveLocalT && !saveCloudT && !saveClaudeT) return;
  saveLocalNow();
  if (saveCloudT) scheduleCloudSave(0);
  if (saveClaudeT) scheduleClaudeSave(0);
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSaves(); });
window.addEventListener("pagehide", flushSaves);
let cursorT = 0;
function sendCursorSoon() {
  if (!live) return;
  clearTimeout(cursorT);
  cursorT = window.setTimeout(() => live?.sendCursor({ t: ed.cursor.t, b: ed.cursor.b, i: ed.cursor.i, row: ed.cursor.row }), 120);
}
function startLive(id: string) {
  live?.close();
  for (const [, pc] of peerCursors) pc.el.remove();
  peerCursors.clear();
  const name = PREFS.name || "Músico";
  const color = "#f2a33a";
  live = new LiveSession(cloud, id, name, color);
  ed.outbox = (ops) => live?.sendOps(ops);
  live.onOps = (ops) => { ed.applyRemote(ops); if (live?.isHost) scheduleCloudSave(); };
  live.onSnapshotRequest = (from) => { if (live?.isHost && from !== clientId) live.sendSnapshot(from, ed.json()); };
  live.onSnapshot = (json) => { ed.replaceScore(fromJson(json), true); toast("Sincronizado con tu dúo."); };
  live.onReloadHint = () => setTimeout(async () => {
    try { const row = await cloud.get(id); if (row) ed.replaceScore(fromJson(row.data), true); } catch { /* se reintenta con el siguiente cambio */ }
  }, 2200);
  live.onCursor = (key, c) => {
    let pc = peerCursors.get(key);
    if (!pc) {
      const p = live?.peers.find((x) => x.key === key);
      const el = h("div", { class: "peer-cursor", hidden: true }, h("span", null, p?.name ?? "Dúo"));
      scoreWrap.append(el);
      pc = { el, name: p?.name ?? "Dúo" };
      peerCursors.set(key, pc);
    }
    pc.c = c;
    drawCursor();
  };
  live.onPeers = (peers) => {
    const others = peers.filter((p) => p.key !== clientId);
    peersEl.replaceChildren(...others.map((p) => h("span", { class: "peerdot" }, h("i", { style: `background:${p.color || "#f2a33a"}` }), p.name)));
    for (const [k, pc] of peerCursors) if (!others.some((p) => p.key === k)) { pc.el.remove(); peerCursors.delete(k); }
    setSync();
    refresh();
  };
}
export async function openSong(id: string) {
  flushSaves();
  let recovered = false;
  savedAt = 0;
  songId = id;
  isCloud = !ARTIFACT && !id.startsWith("local-");
  let json: string | null = null;
  if (isClaudeId(id) && claudeLib) {
    try { json = await claudeLib.load(id.slice(7)); if (!json) toast("No encontré esa canción en tu biblioteca.", true); }
    catch (e) { toast((e as Error).message, true); }
  }
  if (isCloud) {
    try {
      const row = await cloud.get(id);
      if (row) json = row.data;
      else toast("No encontré esa canción en la nube.", true);
      // Recuperación: cambios que se guardaron en el teléfono pero no alcanzaron a subir.
      const pend = pendingSince(id), local = loadLocalDoc(id);
      if (row && pend && local && local !== row.data && pend > Date.parse(row.updated_at)) {
        json = local; recovered = true;
        toast("Recuperé cambios que no habían alcanzado a subir a la nube.");
      }
    } catch (e) {
      toast((e as Error).message, true);
      setSync("Sin conexión con la nube", true);
    }
  }
  json ??= loadLocalDoc(id);
  if (json) ed.replaceScore(fromJson(json));
  location.hash = `#/s/${id}`;
  rememberSong({ id, title: ed.score.title || "Sin título", updated: Date.now(), cloud: isCloud });
  PREFS.last = id; savePrefs();
  if (isCloud) startLive(id); else { live?.close(); live = null; ed.outbox = null; }
  setSync();
  if (recovered) scheduleCloudSave(500);
  refresh();
}
/** Guarda una canción nueva donde corresponde (biblioteca de la cuenta, nube o teléfono) y la abre. */
export async function addSong(score: at.model.Score, toCloud = true) {
  finishScore(score);
  const title = score.title || "Sin título";
  const json = toJson(score);
  let id = `local-${crypto.randomUUID()}`;
  try {
    if (claudeLib && (await claudeLib.ready)) id = `claude-${await claudeLib.create(title, json)}`;
    else if (!ARTIFACT && cloud.session) id = await cloud.createMine(title, json);
    else if (!ARTIFACT && toCloud) id = await cloud.create(title, json);
  } catch (e) { toast(`${(e as Error).message} Quedó guardada en este dispositivo.`, true); }
  saveLocalDoc(id, json);
  ed.replaceScore(score);
  ed.setCursor({ t: 0, b: 0, v: 0, i: 0, row: 0 });
  await openSong(id);
  return id;
}
export async function newSong(styleId: string, title: string, bars: number, toCloud: boolean) {
  await addSong(createSong(styleId, bars, title), toCloud);
}
export async function shareSong(): Promise<string | null> {
  if (!songId) return null;
  if (ARTIFACT) { toast(NO_CLOUD_MSG, true); return null; }
  if (!isCloud) {
    try {
      const id = await cloud.create(ed.score.title, toJson(ed.score));
      saveLocalDoc(id, toJson(ed.score));
      await openSong(id);
    } catch (e) { toast((e as Error).message, true); return null; }
  }
  const base = Capacitor.isNativePlatform() ? PUBLIC_URL : `${location.origin}${location.pathname}`;
  return `${base}#/s/${songId}`;
}
/** Importar crea una canción nueva en la biblioteca (ya no reemplaza la abierta). */
export async function importScore(score: at.model.Score, name = "") {
  if (!score.title) score.title = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Importada";
  await addSong(score);
}
export const ctx = { ed, engine, keys, cloud, claudeLib, addSong, setFx, toast, banks: BANKS, get bank() { return bank; }, setBank, hasPack, openSong, newSong, shareSong, importScore, refresh, prefs: PREFS, savePrefs, get songId() { return songId; }, get isCloud() { return isCloud; }, get live() { return live; } };
const sheets = new Sheets(ctx);
// Acceso para pruebas automáticas (sin efecto en la app).
(window as unknown as { __mf?: unknown }).__mf = ctx;

// ---------- arranque ----------
async function boot() {
  const m = location.hash.match(/#\/s\/([\w-]+)/);
  if (m) { await openSong(m[1]); return; } // enlace del dúo: abre directo, con o sin cuenta
  const last = PREFS.last && localList().find((e) => e.id === PREFS.last);
  if (last) await openSong(last.id);
  else {
    // Primera vez: hoja en blanco en el dispositivo, lista para escribir.
    const id = `local-${crypto.randomUUID()}`;
    ed.score.title = "Mi primera canción";
    saveLocalDoc(id, toJson(ed.score));
    await openSong(id);
  }
  // Web y APK: pide entrar (se puede seguir sin cuenta). Artefacto: la cuenta de Claude basta.
  await cloud.ready; // sesión guardada, o la que trae la vuelta de Google
  cloud.onSession = (s) => {
    setSync();
    if (s && document.querySelector('.sheet form.login')) { sheets.close(); toast(`Hola, ${s.username}.`); sheets.library(); }
  };
  if (!ARTIFACT && !cloud.session && !PREFS.offline) sheets.login(true);
  else if (!last) sheets.library();
  else toast(inputMode === "pad" ? "Toca la tablatura y escribe con el teclado de abajo. → avanza." : "Toca la tablatura y escribe trastes con tu teclado. Espacio avanza.");
}
window.addEventListener("hashchange", () => {
  const m = location.hash.match(/#\/s\/([\w-]+)/);
  if (m && m[1] !== songId) openSong(m[1]);
});
ed.rerender();
refresh();
boot();
if (PREFS.fx) void setFx(true);
