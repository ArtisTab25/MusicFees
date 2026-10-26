// Envoltura de alphaTab: render de partitura/tablatura y reproducción con GeneralUser GS.
import * as at from "@coderline/alphatab";
import { SOUNDFONT_URL } from "../config";

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

  constructor(el: HTMLElement, scrollEl: HTMLElement, zoom = 0.9) {
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
    s.player.soundFont = SOUNDFONT_URL;
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
  set metronome(v: number) { this.api.metronomeVolume = v; }
  get metronome() { return this.api.metronomeVolume; }
  set countIn(v: number) { this.api.countInVolume = v; }
  get countIn() { return this.api.countInVolume; }
  set master(v: number) { this.api.masterVolume = v; }
  get master() { return this.api.masterVolume; }
  seekBeat(beat: at.model.Beat) {
    try {
      this.api.tickPosition = beat.absolutePlaybackStart;
    } catch { /* aún sin reproductor */ }
  }
  playBeat(beat: at.model.Beat) {
    if (this.soundReady && !this.playing) try { this.api.playBeat(beat); } catch { /* sin sonido */ }
  }
  playNote(note: at.model.Note) {
    if (this.soundReady && !this.playing) try { this.api.playNote(note); } catch { /* sin sonido */ }
  }
  syncMix(score: Score) {
    for (const tr of score.tracks) {
      this.api.changeTrackMute([tr], tr.playbackInfo.isMute);
      this.api.changeTrackSolo([tr], tr.playbackInfo.isSolo);
      this.api.changeTrackVolume([tr], tr.playbackInfo.volume / 16 * 1.25);
    }
  }
}
