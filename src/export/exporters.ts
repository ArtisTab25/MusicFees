// Exportar a Guitar Pro (.gp), MIDI, PDF, MP3 y WAV; importar archivos Guitar Pro y MusicXML.
import * as at from "@coderline/alphatab";
import { settings, finishScore } from "../score/model";
import { Capacitor } from "@capacitor/core";

type Score = at.model.Score;

const safeName = (s: string) => (s || "cancion").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "cancion";

type DownloadsCap = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
/** Descarga un archivo. Dentro de un artefacto de Claude usa su permiso de descargas. */
export async function download(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type });
  if (Capacitor.isNativePlatform()) { await saveNative(blob, filename); return; }
  const claude = (window as unknown as { claude?: { use: (n: string) => Promise<unknown> } }).claude;
  if (claude?.use) {
    const dl = (await claude.use("downloads").catch(() => null)) as DownloadsCap | null;
    if (dl) {
      try { await dl.save({ filename, data: blob }); return; }
      catch (e) { const err = e as { code?: string; message?: string }; if (err.code === "declined") return; throw new Error(err.message || "No se pudo guardar el archivo."); }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** En la app Android: guarda en Documentos/MusicFees y abre el menú para enviar o guardar en otro lado. */
async function saveNative(blob: Blob, filename: string) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const data = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  let uri: string;
  try {
    uri = (await Filesystem.writeFile({ path: `MusicFees/${filename}`, data, directory: Directory.Documents, recursive: true })).uri;
  } catch {
    uri = (await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })).uri;
  }
  await Share.share({ title: filename, files: [uri], dialogTitle: "Guardar o enviar" }).catch(() => { /* el usuario cerró el menú */ });
}

export async function exportGp(score: Score) {
  const bytes = new at.exporter.Gp7Exporter().export(score, settings);
  await download(bytes as BlobPart, `${safeName(score.title)}.gp`, "application/octet-stream");
}

export async function exportMidi(score: Score) {
  const mf = new at.midi.MidiFile();
  new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(mf, true)).generate();
  await download(mf.toBinary() as BlobPart, `${safeName(score.title)}.mid`, "audio/midi");
}

export function importFile(bytes: Uint8Array): Score {
  const s = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  finishScore(s);
  return s;
}

/** PDF: render en canvas a ancho de hoja A4 y paginado entre sistemas, sin cortar pentagramas. */
export async function exportPdf(score: Score, tracks: number[], onProgress: (msg: string) => void) {
  onProgress("Preparando las hojas…");
  const { jsPDF } = await import("jspdf");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-20000px;top:0;width:1240px;background:#fff";
  document.body.appendChild(host);
  const s = new at.Settings();
  s.core.engine = "html5";
  s.core.enableLazyLoading = false;
  s.core.useWorkers = false;
  s.core.fontDirectory = `${import.meta.env.BASE_URL}font/`;
  s.display.layoutMode = at.LayoutMode.Page;
  s.display.scale = 1.15;
  s.display.padding = [60, 60, 60, 60];
  s.player.playerMode = at.PlayerMode.Disabled;
  const api = new at.AlphaTabApi(host, s);
  try {
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error("El render del PDF tardó demasiado.")), 60_000);
      api.postRenderFinished.on(() => { clearTimeout(to); res(); });
      api.renderScore(score, tracks);
    });
    await new Promise((r) => setTimeout(r, 150));
    const surface = host.querySelector(".at-surface") as HTMLElement;
    const W = surface.offsetWidth, H = surface.offsetHeight;
    const full = document.createElement("canvas");
    full.width = W;
    full.height = H;
    const ctx = full.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    for (const c of Array.from(surface.querySelectorAll("canvas"))) {
      const r = c.getBoundingClientRect(), sr = surface.getBoundingClientRect();
      ctx.drawImage(c, r.left - sr.left, r.top - sr.top, r.width, r.height);
    }
    // Cortes de página entre sistemas.
    const pageH = Math.round((W * 297) / 210);
    const systems = (api.boundsLookup?.staffSystems ?? []).map((sys) => ({ y: sys.realBounds.y, h: sys.realBounds.h }));
    const cuts: number[] = [0];
    let pageStart = 0;
    for (const sys of systems) {
      if (sys.y + sys.h - pageStart > pageH - 20 && sys.y > pageStart) { cuts.push(sys.y - 10); pageStart = sys.y - 10; }
    }
    cuts.push(H);
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    for (let p = 0; p < cuts.length - 1; p++) {
      onProgress(`Hoja ${p + 1} de ${cuts.length - 1}…`);
      const y0 = cuts[p], h = Math.min(pageH, cuts[p + 1] - y0);
      const page = document.createElement("canvas");
      page.width = W;
      page.height = pageH;
      const pc = page.getContext("2d")!;
      pc.fillStyle = "#fff";
      pc.fillRect(0, 0, W, pageH);
      pc.drawImage(full, 0, y0, W, h, 0, 0, W, h);
      pc.fillStyle = "#555";
      pc.font = "16px sans-serif";
      pc.fillText(`${score.title || "MusicFees"} · ${p + 1}/${cuts.length - 1}`, 60, pageH - 30);
      if (p > 0) pdf.addPage();
      pdf.addImage(page.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, (pw * pageH) / W);
    }
    await download(pdf.output("arraybuffer"), `${safeName(score.title)}.pdf`, "application/pdf");
  } finally {
    api.destroy();
    host.remove();
  }
}


/** Audio: sintetiza la canción completa fuera de tiempo real con el mismo banco de sonidos. */
/** Sintetiza fuera de tiempo real las pistas indicadas (las demás en silencio). Estéreo intercalado, 44.1 kHz. */
async function renderTracks(api: at.AlphaTabApi, score: Score, sf: Uint8Array, list: number[], metronome: boolean, onPct: (pct: number) => void): Promise<Float32Array> {
  const o = new at.synth.AudioExportOptions();
  o.soundFonts = [sf];
  o.sampleRate = SR;
  o.masterVolume = 1;
  o.metronomeVolume = metronome ? 1 : 0;
  for (const t of score.tracks) o.trackVolume.set(t.index, list.includes(t.index) ? 1 : 0);
  const exp = await api.exportAudio(o);
  const chunks: Float32Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const c = await exp.render(2000);
      if (!c) break;
      chunks.push(c.samples);
      total += c.samples.length;
      onPct(c.endTime ? Math.round((c.currentTime / c.endTime) * 100) : 0);
    }
  } finally { exp.destroy(); }
  const inter = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { inter.set(c, off); off += c.length; }
  return inter;
}
const SR = 44100;

export interface AudioOpts {
  metronome: boolean; perTrack: boolean; quality: number;
  soundFont: () => Promise<Uint8Array>;
  /** Con efectos y masterizado (usa las cadenas de Tone.js de la canción). */
  studio: boolean;
}
export async function exportAudio(api: at.AlphaTabApi, score: Score, format: "mp3" | "wav", opts: AudioOpts, onProgress: (msg: string) => void) {
  onProgress("Cargando el banco de sonidos…");
  const sf = await opts.soundFont();
  const save = async (inter: Float32Array, label: string | null) => {
    const name = `${safeName(score.title)}${label ? " - " + safeName(label) : ""}`;
    if (format === "wav") await download(toWav(inter, SR), `${name}.wav`, "audio/wav");
    else await download(await toMp3(inter, SR, opts.quality, (p) => onProgress(`Codificando MP3… ${p}%`)), `${name}.mp3`, "audio/mpeg");
  };
  const tracks = score.tracks.map((t) => t.index);
  if (opts.studio) {
    // Cada pista por separado → su cadena de efectos → suma → masterizado.
    const { processTrack, processMaster, mixInto } = await import("./studioExport");
    const { fxMap, masterOf } = await import("../score/model");
    const fx = fxMap(score);
    const soloOn = score.tracks.some((t) => t.playbackInfo.isSolo);
    const audible = score.tracks.filter((t) => !t.playbackInfo.isMute && (!soloOn || t.playbackInfo.isSolo));
    let mix: Float32Array | null = null;
    const { fxChanges } = await import("../score/model");
    const changes = fxChanges(score);
    for (const [n, t] of audible.entries()) {
      const step = `${n + 1}/${audible.length}: ${t.name}`;
      const dry = await renderTracks(api, score, sf, [t.index], false, (p) => onProgress(`Pista ${step}… ${p} %`));
      onProgress(`Efectos de ${t.name}…`);
      const vol = t.playbackInfo.volume / 16 * 1.25;
      const wet = changes[t.index]?.length
        ? await processWithChanges(api, score, t.index, dry, vol, processTrack, (m) => onProgress(`${m} (${t.name})`))
        : await processTrack(dry, SR, fx[t.index] ?? null, vol);
      if (opts.perTrack) await save(wet, t.name);
      else mix = mixInto(mix, wet);
    }
    if (!opts.perTrack && mix) {
      onProgress("Masterizando…");
      let out: Float32Array = await processMaster(mix, SR, masterOf(score));
      // El metrónomo se suma al final, limpio (sin efectos ni masterizado).
      if (opts.metronome) out = mixInto(out, await renderTracks(api, score, sf, [], true, (p) => onProgress(`Metrónomo… ${p} %`)));
      await save(out, null);
    }
    return;
  }
  const targets = opts.perTrack ? tracks.map((t) => [t]) : [tracks];
  for (const [n, list] of targets.entries()) {
    const label = opts.perTrack ? score.tracks[list[0]].name : null;
    const inter = await renderTracks(api, score, sf, list, opts.metronome, (p) => onProgress(`Generando audio${label ? ` (${n + 1}/${targets.length}: ${label})` : ""}… ${p} %`));
    await save(inter, label);
  }
}

function toWav(inter: Float32Array, sr: number): ArrayBuffer {
  const frames = inter.length / 2, buf = new ArrayBuffer(44 + frames * 4), v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + frames * 4, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, frames * 4, true);
  for (let i = 0; i < inter.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, inter[i])) * 32767, true);
  return buf;
}
async function toMp3(inter: Float32Array, sr: number, kbps: number, prog: (p: number) => void): Promise<BlobPart> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(2, sr, kbps);
  const frames = inter.length / 2, block = 1152 * 20, out: Uint8Array[] = [];
  const L = new Int16Array(block), R = new Int16Array(block);
  for (let f = 0; f < frames; f += block) {
    const n = Math.min(block, frames - f);
    for (let i = 0; i < n; i++) {
      L[i] = Math.max(-1, Math.min(1, inter[(f + i) * 2])) * 32767;
      R[i] = Math.max(-1, Math.min(1, inter[(f + i) * 2 + 1])) * 32767;
    }
    out.push(enc.encodeBuffer(L.subarray(0, n), R.subarray(0, n)).slice());
    if ((f / block) % 20 === 0) { prog(Math.round((f / frames) * 100)); await new Promise((r) => setTimeout(r, 0)); }
  }
  out.push(enc.flush().slice());
  return new Blob(out as BlobPart[]);
}

/**
 * Pista que cambia de cadena de efectos en ciertos compases: se procesa el audio completo con cada
 * cadena distinta y se arma el resultado por tramos (con un cruce de 25 ms en cada cambio).
 */
async function processWithChanges(api: at.AlphaTabApi, score: Score, t: number, dry: Float32Array, vol: number,
  processTrack: (inter: Float32Array, sr: number, fx: import("../score/model").TrackFx | null, volume: number) => Promise<Float32Array>, say: (m: string) => void) {
  const { fxAtBar } = await import("../score/model");
  const { tickToSeconds } = await import("../player/engine");
  // Inicio en segundos de cada compás tal como suena (con repeticiones).
  const mf = new at.midi.MidiFile();
  const gen = new at.midi.MidiFileGenerator(score, api.settings, new at.midi.AlphaSynthMidiFileHandler(mf, true));
  gen.generate();
  const toSec = tickToSeconds(mf);
  const occ = gen.tickLookup.masterBars.map((m) => ({ bar: m.masterBar.index, sec: toSec(m.start) }));
  const variants = new Map<string, { fx: import("../score/model").TrackFx | null; wet?: Float32Array }>();
  const keyOf = occ.map((o) => { const fx = fxAtBar(score, t, o.bar); const k = JSON.stringify(fx); if (!variants.has(k)) variants.set(k, { fx }); return k; });
  let i = 0;
  for (const v of variants.values()) { say(`Cadena ${++i}/${variants.size}`); v.wet = await processTrack(dry, SR, v.fx, vol); }
  const len = Math.max(...[...variants.values()].map((v) => v.wet!.length));
  const out = new Float32Array(len), frames = len / 2, fade = Math.round(0.025 * SR);
  for (let o = 0; o < occ.length; o++) {
    const w = variants.get(keyOf[o])!.wet!;
    const a = o === 0 ? 0 : Math.max(0, Math.round(occ[o].sec * SR) - fade);
    const last = o === occ.length - 1;
    const b = last ? frames : Math.min(frames, Math.round(occ[o + 1].sec * SR));
    for (let f = a; f < b; f++) {
      // Entrada suave al inicio del tramo (salvo el primero); el anterior ya se fue apagando aquí.
      const gin = o > 0 && f < a + fade ? (f - a) / fade : 1;
      const gout = !last && f >= b - fade ? (b - f) / fade : 1;
      const g = Math.min(gin, gout);
      if (f * 2 + 1 < w.length) { out[f * 2] += w[f * 2] * g; out[f * 2 + 1] += w[f * 2 + 1] * g; }
    }
  }
  return out;
}

/**
 * Congelar: cada pista de `tracks` se genera sin conexión con su cadena de efectos (y sus cambios por
 * compás) y se suman en una sola mezcla estéreo intercalada, lista para tocarse sincronizada.
 */
export async function renderFrozenMix(api: at.AlphaTabApi, score: Score, soundFont: () => Promise<Uint8Array>, tracks: number[], onProgress: (msg: string) => void): Promise<{ data: Float32Array; sr: number }> {
  const sf = await soundFont();
  const { processTrack, mixInto, setOfflineLight } = await import("./studioExport");
  const { lightAudio } = await import("../player/studio");
  setOfflineLight(lightAudio()); // al congelar, la calidad del motor en vivo (en teléfonos: ligera, el doble de rápido)
  try {
  const { fxMap, fxChanges } = await import("../score/model");
  const fx = fxMap(score), changes = fxChanges(score);
  let mix: Float32Array | null = null;
  // Las notas se generan una pista a la vez; los efectos de varias pistas se procesan al mismo tiempo
  // (cada contexto sin conexión usa su propio hilo: en un teléfono de 8 núcleos va mucho más rápido).
  const lanes = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
  const running = new Set<Promise<void>>();
  let done = 0;
  const say = () => onProgress(`Congelando… ${done}/${tracks.length} pistas listas`);
  for (const [n, t] of tracks.entries()) {
    const tr = score.tracks[t];
    if (!tr) { done++; continue; }
    const step = `${n + 1}/${tracks.length}: ${tr.name}`;
    const dry = await renderTracks(api, score, sf, [t], false, (p) => onProgress(`Congelando ${step} (notas ${p} %) · ${done} listas`));
    const vol = tr.playbackInfo.isMute ? 0 : tr.playbackInfo.volume / 16 * 1.25;
    const job: Promise<void> = (changes[t]?.length ? processWithChanges(api, score, t, dry, vol, processTrack, () => {}) : processTrack(dry, SR, fx[t] ?? null, vol))
      .then((wet) => { mix = mixInto(mix, wet); done++; say(); })
      .finally(() => running.delete(job));
    running.add(job);
    if (running.size >= lanes) await Promise.race(running);
  }
  await Promise.all(running);
  return { data: mix ?? new Float32Array(2), sr: SR };
  } finally { setOfflineLight(false); }
}
