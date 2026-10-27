// Envoltura de alphaTab: render de partitura/tablatura y reproducción con el banco de sonidos elegido.
import * as at from "@coderline/alphatab";
import type { FxEngine, FxTrack } from "./fxEngine";
import { masterOf, type MasterFx } from "../score/model";

/** Un tiempo del metrónomo: segundos desde el inicio, si es el primero del compás y cuántos tiene el compás. */
export interface Beat { t: number; down: boolean; num: number }
/** Convierte el orden de compases de alphaTab (con repeticiones) en tiempos reales usando los cambios de tempo del MIDI. */
export function beatTimes(mf: at.midi.MidiFile, bars: { start: number; end: number; masterBar: at.model.MasterBar }[]): Beat[] {
  const ppq = 960;
  const tempos: { tick: number; bpm: number }[] = [];
  for (const tr of mf.tracks) for (const e of tr.events) {
    const bpm = (e as unknown as { beatsPerMinute?: number }).beatsPerMinute;
    if (bpm) tempos.push({ tick: e.tick, bpm });
  }
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 });
  // Segundos acumulados al inicio de cada tramo de tempo.
  const acc: number[] = [0];
  for (let i = 1; i < tempos.length; i++) acc.push(acc[i - 1] + ((tempos[i].tick - tempos[i - 1].tick) / ppq) * (60 / tempos[i - 1].bpm));
  let j = 0;
  const toSec = (tick: number) => {
    while (j + 1 < tempos.length && tempos[j + 1].tick <= tick) j++;
    while (j > 0 && tempos[j].tick > tick) j--;
    return acc[j] + ((tick - tempos[j].tick) / ppq) * (60 / tempos[j].bpm);
  };
  const out: Beat[] = [];
  // alphaTab corre todos los eventos del MIDI unos ticks (tickShift); los compases de la búsqueda no.
  const shift = (mf as unknown as { tickShift?: number }).tickShift ?? 0;
  for (const b of bars) {
    const num = b.masterBar.timeSignatureNumerator, step = (ppq * 4) / b.masterBar.timeSignatureDenominator;
    for (let k = 0; k < num; k++) { const tick = b.start + k * step; if (tick < b.end) out.push({ t: toSec(tick + shift), down: k === 0, num }); }
  }
  return out;
}

type Score = at.model.Score;

export interface EngineEvents {
  rendered: () => void;
  position: (currentMs: number, endMs: number, tick: number) => void;
  state: (playing: boolean) => void;
  beat: (beat: at.model.Beat) => void;
  ready: () => void;
  loadProgress: (pct: number) => void;
}

export class Engine {
  api: at.AlphaTabApi;
  score: Score | null = null;
  tracks: number[] = [0];
  playing = false;
  soundReady = false;
  private listeners: Partial<{ [K in keyof EngineEvents]: EngineEvents[K][] }> = {};

  /** Motor con efectos (null = sintetizador de alphaTab). */
  fx: FxEngine | null = null;
  private fxTracks: () => FxTrack[] = () => [];
  private raf = 0;
  /** Banco cargado: una dirección (el incluido) o los bytes de un paquete descargado. */
  private source: string | Uint8Array;

  constructor(el: HTMLElement, scrollEl: HTMLElement, zoom = 0.9, source: string | Uint8Array) {
    this.source = source;
    const s = new at.Settings();
    s.core.engine = "svg";
    s.core.includeNoteBounds = true;
    s.core.useWorkers = true;
    s.core.fontDirectory = `${import.meta.env.BASE_URL}font/`;
    s.display.layoutMode = at.LayoutMode.Page;
    s.display.scale = zoom;
    s.display.padding = [12, 12, 12, 12];
    s.notation.rhythmMode = at.TabRhythmMode.ShowWithBars;
    s.player.playerMode = at.PlayerMode.EnabledAutomatic;
    s.player.soundFont = typeof source === "string" ? source : null;
    s.player.scrollElement = scrollEl;
    s.player.enableCursor = true;
    s.player.enableAnimatedBeatCursor = true;
    s.player.enableUserInteraction = false;
    s.player.scrollMode = at.ScrollMode.Continuous;
    s.player.scrollOffsetY = -40;
    this.api = new at.AlphaTabApi(el, s);
    this.api.renderFinished.on(() => this.emit("rendered"));
    this.api.playerPositionChanged.on((e) => this.emit("position", e.currentTime, e.endTime, e.currentTick));
    this.api.playerStateChanged.on((e) => {
      this.playing = e.state === at.synth.PlayerState.Playing;
      this.emit("state", this.playing);
    });
    this.api.playedBeatChanged.on((b) => this.emit("beat", b));
    this.api.soundFontLoad.on((e) => this.emit("loadProgress", Math.round((e.loaded / Math.max(1, e.total)) * 100)));
    // Un banco descargado se entrega en bytes en cuanto el reproductor está listo para recibirlo.
    if (typeof source !== "string") {
      let sent = false;
      this.api.player?.ready.on(() => { if (!sent) { sent = true; this.api.loadSoundFont(source, false); } });
    }
    // Con efectos, el MIDI que genera alphaTab es el que toca el otro motor.
    // (alphaTab usa curvas de bend de MIDI 2.0; para el otro motor se genera un MIDI estándar con los mismos tiempos.)
    this.api.midiLoad.on(() => { if (this.fx) { const m = this.smf1(); this.fx.loadSong(m.midi, this.fxTracks(), m.beats); this.reseek(); this.fx.setMaster(masterOf(this.api.score!)); } });
    this.api.playerReady.on(() => {
      this.soundReady = true;
      this.emit("ready");
    });
  }

  on<K extends keyof EngineEvents>(k: K, fn: EngineEvents[K]) {
    (this.listeners[k] ??= [] as never[]).push(fn as never);
  }
  private emit<K extends keyof EngineEvents>(k: K, ...args: Parameters<EngineEvents[K]>) {
    for (const fn of this.listeners[k] ?? []) (fn as (...a: unknown[]) => void)(...args);
  }

  render(score: Score, tracks: number[]) {
    this.score = score;
    this.tracks = tracks.filter((t) => t >= 0 && t < score.tracks.length);
    if (!this.tracks.length) this.tracks = [0];
    this.api.renderScore(score, this.tracks);
  }
  /** Cambia de banco de sonidos sin recargar la canción. */
  setSoundFont(source: string | Uint8Array) {
    if (source === this.source) return;
    this.source = source;
    this.soundReady = false;
    this.api.loadSoundFont(source, false);
  }
  // ---------- motor con efectos ----------
  /** MIDI estándar (SMF 1) de la canción, con los mismos tiempos que el que usa alphaTab. */
  /** MIDI estándar y los tiempos del metrónomo (en segundos, en orden de reproducción con repeticiones). */
  private smf1(): { midi: Uint8Array; beats: Beat[] } {
    const mf = new at.midi.MidiFile();
    const gen = new at.midi.MidiFileGenerator(this.api.score!, this.api.settings, new at.midi.AlphaSynthMidiFileHandler(mf, true));
    gen.generate();
    return { midi: mf.toBinary(), beats: beatTimes(mf, gen.tickLookup.masterBars) };
  }
  /** Activa los efectos: `soundFont` es el banco original (sin adaptar). */
  async enableFx(soundFont: Uint8Array, tracks: () => FxTrack[], master: MasterFx | null = null) {
    if (this.fx) return;
    const { FxEngine } = await import("./fxEngine");
    const fx = await FxEngine.create(soundFont, master);
    this.fx = fx;
    fx.metronome = this.metro;
    fx.countIn = this.count > 0;
    this.api.metronomeVolume = 0;
    this.api.countInVolume = 0;
    this.fxTracks = tracks;
    this.soundReady = false;
    this.api.settings.player.playerMode = at.PlayerMode.EnabledExternalMedia;
    this.api.updateSettings();
    const output = () => (this.api.player as unknown as { instance?: { output?: { updatePosition(t: number): void }; handler?: unknown } }).instance;
    const tick = () => {
      output()?.output?.updatePosition(fx.timeMs);
      if (!fx.paused) this.raf = requestAnimationFrame(tick);
    };
    const handler = {
      get backingTrackDuration() { return fx.durationMs; },
      get playbackRate() { return rate; }, set playbackRate(v: number) { rate = v; fx.rate = v; },
      get masterVolume() { return vol; }, set masterVolume(v: number) { vol = v; fx.volume = v; },
      seekTo: (ms: number) => { fx.seek(ms); output()?.output?.updatePosition(ms); },
      play: () => { void fx.play().then(() => { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(tick); }); },
      pause: () => { fx.pause(); cancelAnimationFrame(this.raf); output()?.output?.updatePosition(fx.timeMs); },
    };
    let rate = 1, vol = 1;
    const inst = output();
    if (inst) inst.handler = handler;
    this.api.loadMidiForScore();
    this.soundReady = true;
    this.emit("ready");
  }
  /** Vuelve al sintetizador de alphaTab (con metrónomo y cuenta inicial). */
  disableFx() {
    if (!this.fx) return;
    cancelAnimationFrame(this.raf);
    this.fx.destroy();
    this.fx = null;
    this.soundReady = false;
    this.api.settings.player.playerMode = at.PlayerMode.EnabledAutomatic;
    this.api.settings.player.soundFont = typeof this.source === "string" ? this.source : null;
    this.api.updateSettings();
    this.api.metronomeVolume = this.metro;
    this.api.countInVolume = this.count;
    if (typeof this.source !== "string") {
      const bytes = this.source;
      let sent = false;
      this.api.player?.ready.on(() => { if (!sent) { sent = true; this.api.loadSoundFont(bytes, false); } });
    }
  }
  /** Los bytes del banco actual (para exportar audio). */
  async soundFontBytes(): Promise<Uint8Array> {
    if (typeof this.source !== "string") return this.source;
    return new Uint8Array(await (await fetch(this.source)).arrayBuffer());
  }
  setZoom(z: number) {
    this.api.settings.display.scale = z;
    this.api.updateSettings();
    this.api.render();
  }
  setLayout(page: boolean) {
    this.api.settings.display.layoutMode = page ? at.LayoutMode.Page : at.LayoutMode.Horizontal;
    this.api.updateSettings();
    this.api.render();
  }
  get bounds() {
    return this.api.boundsLookup;
  }
  playPause() { this.api.playPause(); }
  stop() { this.api.stop(); }
  set speed(v: number) { this.api.playbackSpeed = v; }
  get speed() { return this.api.playbackSpeed; }
  set loop(v: boolean) { this.api.isLooping = v; }
  get loop() { return this.api.isLooping; }
  // Con el motor de estudio, metrónomo y cuenta inicial los toca ese motor (alphaTab no suena).
  set metronome(v: number) { this.api.metronomeVolume = this.fx ? 0 : v; if (this.fx) this.fx.metronome = v; this.metro = v; }
  get metronome() { return this.metro; }
  set countIn(v: number) { this.api.countInVolume = this.fx ? 0 : v; if (this.fx) this.fx.countIn = v > 0; this.count = v; }
  get countIn() { return this.count; }
  private metro = 0;
  private count = 0;
  set master(v: number) { this.api.masterVolume = v; }
  get master() { return this.api.masterVolume; }
  /** Último tiempo pedido (en ticks); al recargar el MIDI del motor de estudio se vuelve a aplicar. */
  private lastTick = 0;
  private reseek() { try { this.api.tickPosition = this.lastTick; } catch { /* sin reproductor */ } }
  seekBeat(beat: at.model.Beat) {
    this.lastTick = beat.absolutePlaybackStart;
    try {
      this.api.tickPosition = beat.absolutePlaybackStart;
    } catch { /* aún sin reproductor */ }
  }
  playBeat(beat: at.model.Beat) {
    if (this.fx) { for (const n of beat.notes) this.playNote(n); return; }
    if (this.soundReady && !this.playing) try { this.api.playBeat(beat); } catch { /* sin sonido */ }
  }
  playNote(note: at.model.Note) {
    if (this.fx) {
      const tr = note.beat.voice.bar.staff.track, pi = tr.playbackInfo;
      const drum = tr.staves[0].isPercussion;
      const key = drum ? (tr.percussionArticulations[note.percussionArticulation]?.outputMidiNumber ?? 38) : note.realValue;
      this.fx.previewNote(drum ? 9 : pi.primaryChannel, pi.program, key);
      return;
    }
    if (this.soundReady && !this.playing) try { this.api.playNote(note); } catch { /* sin sonido */ }
  }
  syncMix(score: Score) {
    if (this.fx) { this.fx.route(this.fxTracks()); return; }
    for (const tr of score.tracks) {
      this.api.changeTrackMute([tr], tr.playbackInfo.isMute);
      this.api.changeTrackSolo([tr], tr.playbackInfo.isSolo);
      this.api.changeTrackVolume([tr], tr.playbackInfo.volume / 16 * 1.25);
    }
  }
}
