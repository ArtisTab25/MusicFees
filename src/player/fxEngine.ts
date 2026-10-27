// Motor de estudio: toca la canción con spessasynth (salida separada por canal MIDI) y pasa cada
// pista por su cadena de Tone.js (ver studio.ts), luego por el bus de masterizado.
// alphaTab sigue dibujando y moviendo el cursor (modo «medio externo»): este motor le da el tiempo.
// Se carga solo cuando se activa (menú → Sonido), así no pesa en el arranque.
import * as Tone from "tone";
import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import type { MasterFx, PluginRef, TrackFx } from "../score/model";
import { createPlugin, type WamInstance } from "./wam";
import { MasterChain, TrackChain, lightAudio, makeBuses, setLightAudio, type Buses } from "./studio";
import type { Beat } from "./engine";

const CH = 16;
export interface FxTrack { index: number; channels: number[]; fx: TrackFx | null; mute: boolean; solo: boolean }

export class FxEngine {
  ctx: Tone.Context;
  private synth!: WorkletSynthesizer;
  private seq!: Sequencer;
  private master!: MasterChain;
  private buses!: Buses;
  private chans: Tone.Gain[] = [];
  private chains = new Map<number, TrackChain>();
  // ---------- metrónomo y cuenta inicial ----------
  metronome = 0;
  countIn = false;
  private beats: Beat[] = [];
  private clickHi!: AudioBuffer;
  private clickLo!: AudioBuffer;
  private clickOut!: Tone.Gain;
  private sched = 0;
  private nextBeat = 0;
  private counting = false;
  /** Medidor de la salida (para el indicador de nivel del masterizado). */
  meter!: Tone.Meter;
  ready = false;
  get durationMs() { return (this.seq?.duration ?? 0) * 1000; }

  /** Contexto de audio nativo: Tone.js lo usa tal cual y los plugins WAM lo necesitan así. */
  readonly native: AudioContext;
  private constructor() {
    this.native = new AudioContext({ latencyHint: "playback" });
    this.ctx = new Tone.Context(this.native);
  }
  static async create(soundFont: Uint8Array, master: MasterFx | null, light = false): Promise<FxEngine> {
    setLightAudio(light);
    const e = new FxEngine();
    const ctx = e.ctx;
    const o = { context: ctx };
    e.meter = new Tone.Meter({ ...o, smoothing: 0.8 });
    e.master = new MasterChain(ctx, ctx.destination);
    e.master.output.connect(e.meter);
    e.master.set(master);
    e.buses = await makeBuses(ctx, e.master.input);
    for (let i = 0; i < CH; i++) e.chans.push(new Tone.Gain(o));
    // Clic de metrónomo: va directo a la salida (no pasa por el masterizado ni se graba).
    e.clickOut = new Tone.Gain({ ...o, gain: 0.6 });
    e.clickOut.connect(ctx.destination);
    e.clickHi = clickBuffer(ctx, 1760, 0.035);
    e.clickLo = clickBuffer(ctx, 1175, 0.03);
    // El sintetizador vive en el mismo contexto que Tone (envoltura compatible), así se conectan directo.
    await e.native.audioWorklet.addModule(processorUrl);
    e.synth = new WorkletSynthesizer(e.native);
    const buf = soundFont.buffer.slice(soundFont.byteOffset, soundFont.byteOffset + soundFont.byteLength) as ArrayBuffer;
    await e.synth.soundBankManager.addSoundBank(buf, "main");
    await e.synth.isReady;
    // spessasynth trae su propia reverb, chorus y delay por nota (en JavaScript, en el hilo de audio).
    // Su salida de efectos ni siquiera se conecta (los efectos son los de MusicFees): se apagan.
    e.synth.setSystemParameter("effectsEnabled", false);
    if (lightAudio()) { e.synth.setSystemParameter("voiceCap", 96); e.synth.setSystemParameter("interpolationType", 0); }
    e.synth.connectIndividualOutputs(e.chans.map((g) => g.input as unknown as AudioNode));
    e.seq = new Sequencer(e.synth, { skipToFirstNoteOn: false });
    e.ready = true;
    e.sleepSoon(4000);
    return e;
  }
  /** Carga el MIDI de la canción y conecta cada canal a la cadena de su pista. */
  private lastMidi: Uint8Array | null = null;
  loadSong(midi: Uint8Array, tracks: FxTrack[], beats: Beat[] = []) {
    this.beats = beats;
    // Muchas ediciones (efectos, nombre, notación) no cambian el MIDI: no se vuelve a cargar la canción.
    const same = this.lastMidi && this.lastMidi.length === midi.length && this.lastMidi.every((v, i) => v === midi[i]);
    if (same) { this.route(tracks); return; }
    this.lastMidi = midi.slice();
    const bin = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
    // La carga termina después (en el hilo de audio) y entonces el secuenciador arranca solo: hasta el
    // aviso «songChange» no se sabe su posición real. Ahí se pausa y se fija la posición pedida.
    this.loaded = new Promise<void>((res) => {
      this.seq.eventHandler.timeDelay = 0;
      this.seq.eventHandler.addEvent("songChange", "mf-load", () => {
        this.seq.pause();
        this.seq.currentTime = this.target;
        (this.seq as unknown as { pausedTime?: number }).pausedTime = this.target;
        res();
      });
    });
    this.seq.loadNewSongList([{ binary: bin, fileName: "musicfees.mid" }]);
    // Sin esto el secuenciador salta al primer «note on» (la canción empezaba 0.26 s adelantada).
    this.seq.skipToFirstNoteOn = false;
    this.seq.loopCount = 0;
    // Cargar una lista hace que el secuenciador empiece a tocar solo: se pausa. La posición buena la
    // guarda `target` y se fija justo antes de tocar (la respuesta de la pausa llega tarde y trae otra).
    this.seq.pause();
    this.target = 0;
    this.route(tracks);
  }
  route(tracks: FxTrack[]) {
    for (const ch of this.chans) ch.disconnect();
    const soloOn = tracks.some((t) => t.solo);
    const seen = new Set<number>();
    for (const t of tracks) {
      let chain = this.chains.get(t.index);
      if (!chain) { chain = new TrackChain(this.ctx, this.buses, this.master.input); this.chains.set(t.index, chain); }
      chain.set(t.fx);
      void this.syncPlugins(t.index, t.fx?.plugins ?? []);
      chain.level = t.mute || (soloOn && !t.solo) ? 0 : 1;
      for (const c of t.channels) { const k = c % CH; if (!seen.has(k)) { this.chans[k].connect(chain.input); seen.add(k); } }
    }
    for (const [i, chain] of this.chains) if (!tracks.some((t) => t.index === i)) {
      chain.dispose(); this.chains.delete(i);
      for (const w of this.plugins.get(i)?.insts ?? []) { try { w.audioNode.destroy?.(); } catch { /* nada */ } }
      this.plugins.delete(i);
    }
  }
  setTrackFx(index: number, fx: TrackFx | null) { this.chains.get(index)?.set(fx); void this.syncPlugins(index, fx?.plugins ?? []); }

  // ---------- plugins WAM ----------
  private plugins = new Map<number, { key: string; insts: WamInstance[]; chain: TrackChain }>();
  /** Errores de carga por pista (para mostrarlos en la interfaz). */
  pluginErrors = new Map<number, string>();
  /** Crea o reutiliza las instancias de plugins de una pista y las conecta en su cadena.
   *  Las llamadas de una misma pista van en fila: si dos se cruzaban, se creaban plugins de más que
   *  nunca se destruían y seguían gastando procesador. */
  private plugQueue = new Map<number, Promise<void>>();
  syncPlugins(index: number, refs: PluginRef[]): Promise<void> {
    const next = (this.plugQueue.get(index) ?? Promise.resolve()).then(() => this.doSyncPlugins(index, refs)).catch(() => { /* error ya anotado */ });
    this.plugQueue.set(index, next);
    return next;
  }
  private async doSyncPlugins(index: number, refs: PluginRef[]) {
    const key = JSON.stringify(refs.map((r) => r.src));
    const cur = this.plugins.get(index);
    const chain = this.chains.get(index);
    if (!chain) return;
    if (cur && cur.key === key) { if (cur.chain !== chain) { chain.setPluginNodes(cur.insts.map((i) => i.audioNode)); cur.chain = chain; } return; }
    if (!refs.length && !cur) return;
    const insts: WamInstance[] = [];
    this.pluginErrors.delete(index);
    if (refs.length) await this.ctx.resume(); // los plugins se inicializan en el hilo de audio
    for (const r of refs) {
      try { insts.push(await createPlugin(this.native, r)); }
      catch (e) { this.pluginErrors.set(index, `No se pudo cargar «${r.name}»: ${(e as Error).message}`); }
    }
    if (cur) for (const i of cur.insts) { try { i.audioNode.disconnect(); i.audioNode.destroy?.(); } catch { /* nada */ } }
    this.plugins.set(index, { key, insts, chain });
    chain.setPluginNodes(insts.map((i) => i.audioNode));
    this.sleepSoon();
  }
  pluginInstances(index: number) { return this.plugins.get(index)?.insts ?? []; }
  setMaster(m: MasterFx | null) { this.master.set(m); }
  /** Nivel de salida en dB (para el medidor). */
  get levelDb() { const v = this.meter.getValue(); return typeof v === "number" ? v : Math.max(...v); }

  // ---------- transporte (lo llama alphaTab a través del manejador de medio externo) ----------
  // Se usa `currentTime` (reloj del audio). `currentHighResolutionTime` es una versión suavizada para
  // animaciones que arranca con ~0.25 s de error: desfasaba el metrónomo y el cursor.
  // Reloj propio: el estimado del secuenciador en el hilo principal tarda ~0.2 s en alinearse con el
  // audio (medido). La música real entra al momento de `play`, así que se ancla ahí.
  private anchor: { ctx: number; song: number } | null = null;
  private get songNow() {
    if (this.anchor && !this.seq.paused) return this.anchor.song + (this.ctx.currentTime - this.anchor.ctx) * (this.seq.playbackRate || 1);
    return this.target;
  }
  get timeMs() { return this.songNow * 1000; }
  get paused() { return this.seq?.paused ?? true; }
  /** Posición desde la que se toca (segundos), la última que pidió alphaTab o donde se pausó. */
  private target = 0;
  private loaded: Promise<void> = Promise.resolve();
  // ---------- reposo ----------
  // En pausa el contexto de audio se suspende: si no, el procesador sigue calculando todas las
  // cadenas de efectos en silencio (medido: ~38 % de un núcleo de computadora; en un teléfono, todo).
  private sleepT = 0;
  /** Suspende el audio en unos segundos (deja sonar las colas de reverb y delay). */
  private sleepSoon(ms = 3000) {
    clearTimeout(this.sleepT);
    this.sleepT = window.setTimeout(() => { if (this.seq?.paused && !this.counting && this.native.state === "running") void this.native.suspend(); }, ms);
  }
  private wake() { clearTimeout(this.sleepT); return this.ctx.resume(); }
  /** Cada play y cada pausa cambian este número: un play que todavía esperaba (audio dormido,
   *  canción cargando o cuenta inicial) y que ya fue pausado no arranca después por su cuenta. */
  private playId = 0;
  async play() {
    const id = ++this.playId;
    await this.wake();
    await this.loaded;
    if (id !== this.playId) return;
    const t0 = this.target;
    // La posición se manda antes de la cuenta inicial: la respuesta del secuenciador llega mientras
    // suenan los clics y no corrige el reloj cuando la canción ya empezó.
    if (Math.abs(this.seq.currentTime - t0) > 0.005) this.seq.currentTime = t0;
    if (this.countIn && this.beats.length) {
      // Un compás de clics al tempo del punto de partida, y después arranca la canción.
      // Si se empieza a mitad de un tiempo, la canción entra a esa distancia del último clic, en el pulso.
      let i = this.beats.findIndex((b) => b.t > t0 + 0.01) - 1;
      if (i < 0) i = this.beats[0].t > t0 + 0.01 ? 0 : this.beats.length - 1;
      const here = this.beats[i], next = this.beats[i + 1], rate = this.seq.playbackRate || 1;
      const beat = (next && next.t > here.t ? next.t - here.t : 0.5) / rate;
      const frac = Math.max(0, t0 - here.t) / rate;
      const num = here.num || 4, start = this.ctx.currentTime + 0.08;
      this.counting = true;
      for (let k = 0; k < num; k++) this.click(start + k * beat, k === 0, 1);
      await new Promise((r) => setTimeout(r, (0.08 + num * beat + frac) * 1000 - 15));
      this.counting = false;
      if (id !== this.playId) return;
    }
    // Si llegó otra posición durante la cuenta, manda la última.
    const t1 = this.target;
    if (Math.abs(t1 - t0) > 0.005) this.seq.currentTime = t1;
    (this.seq as unknown as { pausedTime?: number }).pausedTime = t1; // el reloj local arranca desde aquí
    this.seq.play();
    // La música entra ~15 ms después de la orden (mensaje al hilo de audio), medido con un analizador.
    this.anchor = { ctx: this.ctx.currentTime + 0.015, song: t1 };
    this.startClicks();
  }
  pause() {
    this.playId++;
    if (!this.counting && this.anchor) this.target = this.songNow;
    this.counting = false;
    this.anchor = null; this.seq.pause(); this.stopClicks(); this.sleepSoon();
  }
  seek(ms: number) {
    this.target = Math.max(0, ms / 1000);
    this.seq.currentTime = this.target;
    if (this.anchor) this.anchor = { ctx: this.ctx.currentTime, song: this.target };
    this.nextBeat = -1;
  }
  private click(at: number, down: boolean, vol = this.metronome) {
    const src = this.ctx.createBufferSource();
    src.buffer = down ? this.clickHi : this.clickLo;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(1, vol);
    src.connect(g);
    Tone.connect(g, this.clickOut);
    src.start(at);
  }
  /** Programa los clics que caen en los próximos 150 ms, cada 30 ms, siguiendo el tiempo de la canción. */
  private startClicks() {
    this.stopClicks();
    const from = this.anchor?.song ?? this.target;
    this.nextBeat = this.beats.findIndex((b) => b.t >= from - 0.001); // incluye el tiempo en que arranca
    const tick = () => {
      if (!this.metronome || this.seq.paused || this.counting || !this.beats.length) return;
      const now = this.songNow, rate = this.seq.playbackRate || 1;
      if (this.nextBeat < 0 || this.beats[this.nextBeat]?.t < now - 0.2) this.nextBeat = Math.max(0, this.beats.findIndex((b) => b.t >= now - 0.005));
      while (this.nextBeat >= 0 && this.nextBeat < this.beats.length && this.beats[this.nextBeat].t < now + 0.15 * rate) {
        const b = this.beats[this.nextBeat];
        this.click(this.ctx.currentTime + Math.max(0, (b.t - now) / rate), b.down);
        this.nextBeat++;
      }
    };
    tick();
    this.sched = window.setInterval(tick, 30);
  }
  private stopClicks() { clearInterval(this.sched); this.sched = 0; }
  set rate(r: number) {
    if (!this.seq) return;
    if (this.anchor) this.anchor = { ctx: this.ctx.currentTime, song: this.songNow };
    this.seq.playbackRate = r;
  }
  set volume(v: number) { this.master.output.gain.value = v; }
  /** Toca una nota suelta (al escribir) por el canal de la pista, con sus efectos. */
  previewNote(channel: number, program: number, key: number, velocity = 100) {
    if (!this.ready || !this.seq.paused) return;
    void this.wake();
    this.sleepSoon(2500);
    if (channel !== 9) this.synth.programChange(channel, program);
    this.synth.noteOn(channel, key, velocity);
    setTimeout(() => this.synth.noteOff(channel, key), 600);
  }
  destroy() {
    clearTimeout(this.sleepT);
    this.stopClicks();
    try { this.seq?.pause(); } catch { /* nada */ }
    try { this.synth?.destroy(); } catch { /* nada */ }
    for (const c of this.chains.values()) c.dispose();
    void this.ctx.close();
  }
}

/** Un clic corto de madera: seno con caída rápida. */
function clickBuffer(ctx: Tone.Context, freq: number, dur: number) {
  const sr = ctx.sampleRate, n = Math.floor(sr * dur), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / sr) * Math.exp(-i / (sr * dur * 0.18));
  return buf;
}
