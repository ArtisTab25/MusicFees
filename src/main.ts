import "./styles.css";
import * as at from "@coderline/alphatab";
import { Engine } from "./player/engine";
import { Editor } from "./editor/editor";
import { KeyInput } from "./editor/keys";
import { createSong, fromJson, toJson, finishScore, kindOf } from "./score/model";
import { Cloud, LiveSession, clientId, loadLocalDoc, localList, rememberSong, saveLocalDoc, type Peer } from "./collab/cloud";
import { h, $, icon } from "./ui/dom";
import { buildPalettes } from "./ui/palettes";
import { Sheets } from "./ui/sheets";
import { midiName, pcName } from "./score/chords";
import { DRUM_PIECES, LATIN_PIECES } from "./score/instruments";

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
const engine = new Engine(scoreEl, scoreWrap, PREFS.zoom ?? 0.85);
if (PREFS.layout === "h") engine.setLayout(false);
const ed = new Editor(createSong("blank_gtr", 8), engine);
const keys = new KeyInput(ed, (m) => toast(m));
const cloud = new Cloud();
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
const r1 = h("div", { class: "row r1" }, voiceSeg, btnView, btnLyrics, btnChords, greens);

const zoomVal = h("span", { class: "zoomv" }, "");
const btnUndo = tb("undo", "Deshacer", () => ed.undo());
const btnRedo = tb("redo", "Rehacer", () => ed.redo());
const btnLayout = tb(PREFS.layout === "h" ? "scroll" : "page", "Vista de página u horizontal", () => {
  PREFS.layout = PREFS.layout === "h" ? "p" : "h"; savePrefs(); engine.setLayout(PREFS.layout !== "h");
  btnLayout.replaceChildren(icon(PREFS.layout === "h" ? "scroll" : "page", 20));
});
const btnKbd = tb("keyboard", "Mostrar el teclado para escribir", () => keys.focus());
const btnCompact = tb("chevronDown", "Ocultar o mostrar filas", () => { document.body.classList.toggle("compact"); PREFS.compact = document.body.classList.contains("compact"); savePrefs(); });
const r2 = h("div", { class: "row r2" },
  tb("home", "Ir al inicio", () => { ed.setCursor({ b: 0, i: 0 }); scoreWrap.scrollTo({ top: 0 }); }),
  btnLayout,
  tb("zoomOut", "Alejar", () => setZoom(-0.1)), zoomVal, tb("zoomIn", "Acercar", () => setZoom(0.1)),
  btnUndo, btnRedo, btnKbd, btnCompact);

const btnCount = tb("countin", "Cuenta antes de tocar", () => { engine.countIn = engine.countIn > 0 ? 0 : 1; refresh(); });
const btnLoop = tb("loop", "Repetir", () => { engine.loop = !engine.loop; refresh(); });
const speedVal = h("span", { class: "zoomv" }, "100%");
const btnMetro = tb("metro", "Metrónomo", () => { engine.metronome = engine.metronome > 0 ? 0 : 1; refresh(); });
const readout = h("span", { class: "readout", "aria-live": "off" });
const r3 = h("div", { class: "row r3" }, btnCount, btnLoop,
  tb("down", "Más lento", () => setSpeed(-0.1)), speedVal, tb("up", "Más rápido", () => setSpeed(0.1)),
  btnMetro, readout);

const playBtn = h("button", { class: "play", "aria-label": "Reproducir", onclick: () => { engine.playPause(); } }, icon("play", 26));
const chipName = h("span", { class: "nm" });
const chipMeta = h("span", { class: "meta" });
const chip = h("button", { class: "chip", "aria-label": "Pista actual, abrir pistas", onclick: () => sheets.tracks() }, chipName, chipMeta);
const transport = h("div", { class: "transport" },
  h("button", { class: "skip", "aria-label": "Compás anterior", onclick: () => jumpBar(-1) }, icon("prev", 28)),
  playBtn,
  h("button", { class: "skip", "aria-label": "Compás siguiente", onclick: () => jumpBar(1) }, icon("next", 28)),
  chip);
tools.append(ctxStrip, r1, r2, r3, transport);
if (PREFS.compact) document.body.classList.add("compact");
// Tocar la barra no debe cerrar el teclado del teléfono.
for (const el of [tools, paletteHost]) el.addEventListener("mousedown", (e) => {
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
const palettes = buildPalettes(ed, { toast, close: () => togglePalette(null) });
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
  } else {
    const names = new Map([...DRUM_PIECES, ...LATIN_PIECES].map((p) => [p.id, p]));
    tr.percussionArticulations.forEach((a, idx) => {
      const p = names.get(a.outputMidiNumber);
      const on = !!beat?.notes.some((n) => n.percussionArticulation === idx);
      ctxStrip.append(h("button", { class: "sbtn", "aria-pressed": on, title: p?.name ?? a.elementType, onclick: () => ed.togglePerc(idx) }, p?.short ?? a.elementType.slice(0, 4), h("small", null, p?.name.split(" ")[0] ?? "")));
    });
  }
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
function drawCursor() {
  const off = surfaceOffset();
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
let down: { x: number; y: number; t: number } | null = null;
scoreWrap.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
scoreWrap.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12 || Date.now() - down.t > 600) { down = null; return; }
  down = null;
  const off = surfaceOffset(), bl = engine.bounds;
  if (!off || !bl) return;
  const wr = scoreWrap.getBoundingClientRect();
  const x = e.clientX - wr.left + scoreWrap.scrollLeft - off.x, y = e.clientY - wr.top + scoreWrap.scrollTop - off.y;
  const beat = bl.getBeatAtPos(x, y);
  if (!beat) { keys.focus(); return; }
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
  if (t !== ed.cursor.t) ed.cursor.t = t;
  ed.setCursor({ t, b: beat.voice.bar.index, v: beat.voice.index, i: beat.index, row });
  if (!engine.playing) engine.seekBeat(beat);
  keys.focus();
});

// ---------- refrescar indicadores ----------
function refresh() {
  const sc = ed.score, tr = ed.track, beat = ed.beat;
  titleEl.textContent = sc.title || "Sin título";
  const idx = ed.cursor.t + 1;
  const kindIcon = kindOf(tr) === "drums" ? "drum" : kindOf(tr) === "notation" ? "piano" : "guitar";
  chipName.replaceChildren(icon(kindIcon, 18), `${idx}. ${tr.name}`);
  const mb = ed.masterBar;
  const tempo = Math.round(mb?.tempoAutomation?.value ?? sc.tempo);
  chipMeta.replaceChildren(
    h("span", null, `${ed.cursor.b + 1}/${sc.masterBars.length}`),
    h("span", { class: engine.soundReady ? "ok" : "" }, `● ${mb.timeSignatureNumerator}:${mb.timeSignatureDenominator}`),
    h("span", null, timeText),
  );
  const n = ed.noteAtCursor();
  readout.replaceChildren(
    h("b", null, DUR_GLYPH[beat?.duration ?? 4] ?? "♩"), beat?.dots ? "·" : "",
    h("span", null, DYN[ed.dynamic]),
    h("span", null, n ? (kindOf(tr) === "drums" ? "golpe" : midiName(n.realValue)) : "—"),
    h("span", null, `♩=${tempo}`),
  );
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
  drawCursor();
  if (openPal) { const id = openPal; openPal = null; togglePalette(id); }
}
let timeText = "00:00 / 00:00";
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
let lastPosPaint = 0;
engine.on("position", (cur, end) => {
  timeText = `${fmt(cur)} / ${fmt(end)}`;
  const now = performance.now();
  if (now - lastPosPaint > 250) { lastPosPaint = now; const spans = chipMeta.querySelectorAll("span"); if (spans[2]) spans[2].textContent = timeText; }
});
engine.on("state", (playing) => { playBtn.replaceChildren(icon(playing ? "pause" : "play", 26)); playBtn.setAttribute("aria-label", playing ? "Pausar" : "Reproducir"); });
engine.on("rendered", () => { loadingEl.remove(); drawCursor(); });
engine.on("ready", () => refresh());
engine.on("loadProgress", (p) => { if (p < 100) syncEl.textContent = `Sonidos ${p}%`; else setSync(); });
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
function setSync(msg?: string, err = false) {
  syncEl.textContent = msg ?? (isCloud ? (live?.connected ? "En la nube · en vivo" : "En la nube") : "Solo en este teléfono");
  syncEl.classList.toggle("err", err);
}
ed.onDirty = () => {
  clearTimeout(saveLocalT);
  saveLocalT = window.setTimeout(() => {
    if (!songId) return;
    const json = toJson(ed.score);
    saveLocalDoc(songId, json);
    rememberSong({ id: songId, title: ed.score.title || "Sin título", updated: Date.now(), cloud: isCloud });
  }, 500);
  if (isCloud) scheduleCloudSave();
};
function scheduleCloudSave(delay = 1500) {
  clearTimeout(saveCloudT);
  saveCloudT = window.setTimeout(async () => {
    if (!songId || !isCloud) return;
    if (live && !live.isHost) return; // guarda quien es anfitrión mientras los dos están conectados
    setSync("Guardando…");
    try { await cloud.save(songId, ed.score.title, toJson(ed.score)); setSync(); }
    catch (e) { setSync((e as Error).message, true); }
  }, delay);
}
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
  live.onSnapshotRequest = (from) => { if (live?.isHost && from !== clientId) live.sendSnapshot(from, toJson(ed.score)); };
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
  songId = id;
  isCloud = !id.startsWith("local-");
  let json: string | null = null;
  if (isCloud) {
    try {
      const row = await cloud.get(id);
      if (row) json = row.data;
      else toast("No encontré esa canción en la nube.", true);
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
  refresh();
}
export async function newSong(styleId: string, title: string, bars: number, toCloud: boolean) {
  const score = createSong(styleId, bars, title);
  const json = toJson(score);
  let id = `local-${crypto.randomUUID()}`;
  if (toCloud) {
    try { id = await cloud.create(title, json); }
    catch (e) { toast((e as Error).message, true); }
  }
  saveLocalDoc(id, json);
  ed.replaceScore(score);
  ed.setCursor({ t: 0, b: 0, v: 0, i: 0, row: 0 });
  await openSong(id);
}
export async function shareSong(): Promise<string | null> {
  if (!songId) return null;
  if (!isCloud) {
    try {
      const id = await cloud.create(ed.score.title, toJson(ed.score));
      saveLocalDoc(id, toJson(ed.score));
      await openSong(id);
    } catch (e) { toast((e as Error).message, true); return null; }
  }
  return `${location.origin}${location.pathname}#/s/${songId}`;
}
export function importScore(score: at.model.Score) {
  finishScore(score);
  ed.replaceScore(score);
  ed.setCursor({ t: 0, b: 0, v: 0, i: 0, row: 0 });
  ed.onDirty?.();
  if (isCloud) scheduleCloudSave(300);
}
export const ctx = { ed, engine, keys, cloud, toast, openSong, newSong, shareSong, importScore, refresh, prefs: PREFS, savePrefs, get songId() { return songId; }, get isCloud() { return isCloud; }, get live() { return live; } };
const sheets = new Sheets(ctx);

// ---------- arranque ----------
async function boot() {
  const m = location.hash.match(/#\/s\/([\w-]+)/);
  if (m) { await openSong(m[1]); return; }
  const last = PREFS.last && localList().find((e) => e.id === PREFS.last);
  if (last) { await openSong(last.id); return; }
  // Primera vez: canción en blanco guardada en el teléfono, lista para escribir.
  const id = `local-${crypto.randomUUID()}`;
  ed.score.title = "Mi primera canción";
  saveLocalDoc(id, toJson(ed.score));
  await openSong(id);
  toast("Toca la tablatura y escribe trastes con tu teclado. Espacio avanza.");
}
window.addEventListener("hashchange", () => {
  const m = location.hash.match(/#\/s\/([\w-]+)/);
  if (m && m[1] !== songId) openSong(m[1]);
});
ed.rerender();
refresh();
boot();
