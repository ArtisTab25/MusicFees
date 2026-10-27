// Cadenas de efectos construidas con Tone.js (MIT). Las usa el motor en vivo y la exportación
// de audio (en un contexto sin conexión), así lo que se oye es lo que se graba.
//
// Pista:   entrada → amplificador (ganancia + distorsión + gabinete) → EQ de 3 bandas → compresor
//          → pedales en serie (phaser, trémolo, wah…) → plugins → salida
//          + envíos a los buses compartidos de chorus, delay y reverb (uno para toda la canción,
//            como en una consola: el costo ya no crece con cada pista).
// Master:  suma → EQ → compresor «pegamento» → ancho estéreo → volumen → limitador → salida
import * as Tone from "tone";
import type { MasterFx, Pedal, TrackFx } from "../score/model";
import { octaveSemis } from "./fxPresets";

type Ctx = Tone.BaseContext;

// Tone crea al importarse un contexto de audio propio que queda corriendo aunque no suene nada
// (gasta CPU y batería). Todo MusicFees pasa su contexto explícito, así que ese se cierra y en su
// lugar queda uno sin conexión que nunca procesa.
{
  const def = Tone.getContext();
  if (!(def instanceof Tone.OfflineContext)) {
    Tone.setContext(new Tone.OfflineContext(1, 0.01, 44100));
    void (def as Tone.Context).close().catch(() => { /* ya cerrado */ });
  }
}
const opt = (context: Ctx) => ({ context });
const flat: TrackFx = { preset: "", drive: 0, low: 5, mid: 5, high: 5, comp: 0, chorus: 0, delay: 0, reverb: 0 };

// ---------- calidad ----------
/** Perfil ligero (teléfono): sin sobremuestreo en la distorsión, phaser con menos etapas y reverb
 *  más corta. Medido: la cadena completa en 4 pistas iba a 3.2× tiempo real en computadora, menos
 *  que el tiempo real en un teléfono (de ahí el sonido robótico y lento/acelerado). */
let LIGHT = false;
export const setLightAudio = (v: boolean) => { LIGHT = v; };
export const lightAudio = () => LIGHT;

/** Filtro nativo con valores fijos. Los filtros de Tone.js reciben la frecuencia como señal de audio
 *  y el navegador recalcula sus coeficientes en cada muestra: un EQ de 3 bandas costaba tanto como
 *  el sintetizador entero (medido en el hilo de audio). */
class NFilter extends Tone.ToneAudioNode {
  readonly name = "NFilter";
  input: BiquadFilterNode;
  output: BiquadFilterNode;
  constructor(context: Ctx, type: BiquadFilterType, frequency: number, q = 0.707) {
    super({ context });
    const f = (context.rawContext as unknown as BaseAudioContext).createBiquadFilter();
    f.type = type; f.frequency.value = frequency; f.Q.value = q;
    this.input = f; this.output = f;
  }
  get node() { return this.input; }
}
const isOffline = (context: Ctx) => typeof OfflineAudioContext !== "undefined" && (context.rawContext as unknown) instanceof OfflineAudioContext;

/** Pedal de modulación «a ritmo de control»: filtros nativos que se mueven ~40 veces por segundo
 *  desde el hilo principal (en vez de una señal de audio por muestra). En vivo cuesta una fracción;
 *  al exportar (sin tiempo real) se usan los de Tone.js. */
class ControlPedal extends Tone.ToneAudioNode {
  readonly name = "ControlPedal";
  input: Tone.Gain; output: Tone.Gain;
  private dry: Tone.Gain; private wetG: Tone.Gain;
  private filters: BiquadFilterNode[] = [];
  private timer = 0;
  readonly wet = { set value(v: number) { this.owner.setMix(v); }, get value() { return this.owner.mix; }, owner: this as ControlPedal };
  mix = 0.5;
  constructor(context: Ctx, kind: "phaser" | "autofilter" | "wah", a: number, b: number) {
    super({ context });
    const raw = context.rawContext as unknown as BaseAudioContext, o = { context };
    this.input = new Tone.Gain(o); this.output = new Tone.Gain(o);
    this.dry = new Tone.Gain(o); this.wetG = new Tone.Gain(o);
    this.input.connect(this.dry); this.dry.connect(this.output); this.wetG.connect(this.output);
    const n = kind === "phaser" ? (LIGHT ? 4 : 6) : 1;
    for (let i = 0; i < n; i++) {
      const f = raw.createBiquadFilter();
      f.type = kind === "phaser" ? "allpass" : kind === "wah" ? "bandpass" : "lowpass";
      f.Q.value = kind === "wah" ? 4 : kind === "autofilter" ? 2 : 0.6;
      this.filters.push(f);
    }
    Tone.connect(this.input, this.filters[0]);
    for (let i = 0; i + 1 < n; i++) this.filters[i].connect(this.filters[i + 1]);
    Tone.connect(this.filters[n - 1], this.wetG);
    const t0 = performance.now();
    if (kind === "wah") {
      // Seguidor de envolvente: mide el nivel y abre el filtro al tocar más fuerte.
      const an = raw.createAnalyser(); an.fftSize = 512; Tone.connect(this.input, an);
      const buf = new Float32Array(an.fftSize); let env = 0;
      const base = 80 + a * 300, sens = 0.5 + b * 4;
      this.timer = window.setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        env = rms > env ? rms : env * 0.85;
        this.filters[0].frequency.value = Math.min(4000, base * (1 + env * sens * 30));
      }, 25);
    } else {
      const rate = kind === "phaser" ? 0.15 + a * 3 : 0.2 + a * 6;
      const lo = kind === "phaser" ? 350 : 200, oct = kind === "phaser" ? 1 + b * 4 : 0.5 + b * 3;
      this.timer = window.setInterval(() => {
        const ph = ((performance.now() - t0) / 1000) * rate * 2 * Math.PI;
        const f = lo * Math.pow(2, oct * (Math.sin(ph) + 1) / 2);
        this.filters.forEach((x, i) => { x.frequency.value = f * (1 + i * 0.35); });
      }, 25);
    }
  }
  setMix(v: number) { this.mix = v; this.wetG.gain.value = v; this.dry.gain.value = 1 - v * 0.5; }
  dispose() { clearInterval(this.timer); for (const f of this.filters) f.disconnect(); this.input.dispose(); this.output.dispose(); this.dry.dispose(); this.wetG.dispose(); super.dispose(); return this; }
}

/** Ecualizador de 3 bandas con tres filtros nativos (graves, medios, agudos). Tone.EQ3 usa un
 *  divisor de bandas con el doble de filtros y costaba casi lo mismo que la distorsión. */
class Eq3 {
  readonly lo: NFilter; readonly mid: NFilter; readonly hi: NFilter;
  constructor(context: Ctx, loF: number, hiF: number) {
    this.lo = new NFilter(context, "lowshelf", loF);
    this.mid = new NFilter(context, "peaking", Math.sqrt(loF * hiF), 0.7);
    this.hi = new NFilter(context, "highshelf", hiF);
    this.lo.chain(this.mid, this.hi);
  }
  set(low: number, mid: number, high: number) { this.lo.node.gain.value = low; this.mid.node.gain.value = mid; this.hi.node.gain.value = high; }
  dispose() { this.lo.dispose(); this.mid.dispose(); this.hi.dispose(); }
}

// ---------- pedales ----------
function makePedal(context: Ctx, p: Pedal): Tone.ToneAudioNode {
  const a = p.a / 10, b = p.b / 10, wet = p.mix / 10;
  let n: Tone.ToneAudioNode & { wet: Tone.Signal<"normalRange"> };
  switch (p.type) {
    case "phaser": n = isOffline(context) ? new Tone.Phaser({ ...opt(context), frequency: 0.15 + a * 3, octaves: 1 + b * 4, baseFrequency: 350, stages: 6 }) : new ControlPedal(context, "phaser", a, b) as unknown as typeof n; break;
    case "tremolo": n = new Tone.Tremolo({ ...opt(context), frequency: 1 + a * 9, depth: b, spread: 0 }).start(); break;
    case "wah": if (!isOffline(context)) { n = new ControlPedal(context, "wah", a, b) as unknown as typeof n; break; }
      n = new Tone.AutoWah({ ...opt(context), baseFrequency: 80 + a * 300, octaves: 5, sensitivity: -40 + b * 30, Q: 3 }); break;
    case "autofilter": if (!isOffline(context)) { n = new ControlPedal(context, "autofilter", a, b) as unknown as typeof n; break; }
      n = new Tone.AutoFilter({ ...opt(context), frequency: 0.2 + a * 6, depth: b, baseFrequency: 200, octaves: 3.5 }).start(); break;
    case "vibrato": n = new Tone.Vibrato({ ...opt(context), frequency: 2 + a * 8, depth: b * 0.6 }); break;
    case "pingpong": n = new Tone.PingPongDelay({ ...opt(context), delayTime: 0.08 + a * 0.5, feedback: 0.1 + b * 0.75 }); break;
    case "octave": n = new Tone.PitchShift({ ...opt(context), pitch: octaveSemis(p.a), windowSize: 0.03 + b * 0.12 }); break;
    case "widener": n = new Tone.StereoWidener({ ...opt(context), width: 0.5 + a * 0.5 }); break;
    case "autopan": n = new Tone.AutoPanner({ ...opt(context), frequency: 0.3 + a * 6, depth: b }).start(); break;
    case "harmonic": n = new Tone.Chebyshev({ ...opt(context), order: 2 + Math.round(a * 48) }); break;
    case "spring": n = new Tone.JCReverb({ ...opt(context), roomSize: 0.2 + a * 0.7 }); break;
  }
  n.wet.value = wet;
  return n;
}

/** Curva de saturación suave: más ganancia = más compresión de picos. */
function driveCurve(drive: number) {
  const n = 2048, c = new Float32Array(n), k = drive * drive * 6;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

export class TrackChain {
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;
  readonly send: Tone.Gain;
  private pre: Tone.Gain; private shaper: Tone.WaveShaper; private post: Tone.Gain;
  private hp: NFilter; private lp: NFilter; private eq: Eq3;
  private comp: Tone.Compressor; private makeup: Tone.Gain;
  private pedalIn: Tone.Gain; private pedalOut: Tone.Gain; private pedals: Tone.ToneAudioNode[] = [];
  /** Plugins WAM (nodos nativos) entre los pedales y el chorus. */
  private plugIn: Tone.Gain; private plugOut: Tone.Gain;
  private pedalKey = "";
  private sendChorus: Tone.Gain; private sendDelay: Tone.Gain;
  private buses: Buses;
  private fx: TrackFx = flat;
  private plugCount = 0;
  private linkKey = "";
  private sending = { r: false, c: false, d: false };

  constructor(private context: Ctx, buses: Buses, masterIn: Tone.InputNode) {
    const o = opt(context);
    this.input = new Tone.Gain(o); this.output = new Tone.Gain(o); this.send = new Tone.Gain({ ...o, gain: 0 });
    this.pre = new Tone.Gain(o); this.post = new Tone.Gain(o);
    this.shaper = new Tone.WaveShaper({ ...o });
    this.shaper.oversample = LIGHT ? "none" : "2x";
    this.hp = new NFilter(context, "highpass", 20);
    this.lp = new NFilter(context, "lowpass", 20000);
    this.eq = new Eq3(context, 200, 3200);
    this.comp = new Tone.Compressor({ ...o, attack: 0.005, release: 0.15 });
    this.makeup = new Tone.Gain(o);
    this.pedalIn = new Tone.Gain(o); this.pedalOut = new Tone.Gain(o);
    this.plugIn = new Tone.Gain(o); this.plugOut = new Tone.Gain(o);
    this.sendChorus = new Tone.Gain({ ...o, gain: 0 });
    this.sendDelay = new Tone.Gain({ ...o, gain: 0 });
    // Conexiones fijas dentro de cada etapa; entre etapas se conectan solo las que se usan (relink).
    this.pre.chain(this.shaper, this.post, this.hp, this.lp);
    this.comp.connect(this.makeup);
    this.pedalIn.connect(this.pedalOut);
    this.plugIn.connect(this.plugOut);
    this.output.connect(masterIn);
    this.output.connect(this.send);
    this.output.connect(this.sendChorus);
    this.output.connect(this.sendDelay);
    this.buses = buses;
    this.set(null);
  }
  /** Aplica los valores (0–10). null = pasa limpio. Los pedales se reconectan solo si cambia la lista. */
  set(fx: TrackFx | null) {
    const f = fx ?? flat;
    const d = f.drive / 10;
    this.shaper.curve = d > 0 ? driveCurve(d) : new Float32Array([-1, 1]);
    this.pre.gain.value = 1 + d * 3;
    this.post.gain.value = d > 0 ? 0.55 / (1 + d * 0.6) : 1;
    // Gabinete: con ganancia se recortan graves y agudos, como un parlante de guitarra.
    this.hp.node.frequency.value = d > 0 ? 85 : 20;
    this.lp.node.frequency.value = d > 0 ? 5200 - d * 1400 : 20000;
    this.eq.set((f.low - 5) * 2.5, (f.mid - 5) * 2.5, (f.high - 5) * 2.5);
    this.comp.threshold.value = f.comp > 0 ? -6 - f.comp * 3 : 0;
    this.comp.ratio.value = f.comp > 0 ? 1 + f.comp * 0.9 : 1;
    this.makeup.gain.value = 1 + f.comp * 0.07;
    this.sendChorus.gain.value = (f.chorus / 10) * 0.7;
    this.sendDelay.gain.value = (f.delay / 10) * 0.5;
    this.send.gain.value = (f.reverb / 10) * 0.7;
    this.setPedals(f.pedals ?? []);
    this.fx = f;
    this.relink();
  }
  /** Conecta en serie solo las etapas que hacen algo. Una etapa desconectada no se procesa:
   *  una pista «sin efectos» pasa directo y casi no gasta. */
  private relink() {
    const f = this.fx;
    const stages: [string, Tone.ToneAudioNode, Tone.ToneAudioNode][] = [];
    if (f.drive > 0) stages.push(["amp", this.pre, this.lp]);
    if (f.low !== 5 || f.mid !== 5 || f.high !== 5) stages.push(["eq", this.eq.lo, this.eq.hi]);
    if (f.comp > 0) stages.push(["comp", this.comp, this.makeup]);
    if (this.pedals.length) stages.push(["pedals", this.pedalIn, this.pedalOut]);
    if (this.plugCount) stages.push(["plugins", this.plugIn, this.plugOut]);
    const key = stages.map(([k]) => k).join(">") || "directo";
    if (key !== this.linkKey) {
      this.linkKey = key;
      for (const n of [this.input, this.lp, this.eq.hi, this.makeup, this.pedalOut, this.plugOut]) n.disconnect();
      let at: Tone.ToneAudioNode = this.input;
      for (const [, head, tail] of stages) { at.connect(head); at = tail; }
      at.connect(this.output);
    }
    // Un envío en cero no se conecta: el bus no procesa lo que no recibe.
    const link = (on: boolean, key: "r" | "c" | "d", g: Tone.Gain, bus: "reverb" | "chorus" | "delay") => {
      if (on === this.sending[key]) return;
      this.sending[key] = on;
      if (on) g.connect(this.buses[bus]); else g.disconnect();
      this.buses.use(bus, on ? 1 : -1);
    };
    link(f.reverb > 0, "r", this.send, "reverb");
    link(f.chorus > 0, "c", this.sendChorus, "chorus");
    link(f.delay > 0, "d", this.sendDelay, "delay");
  }
  private setPedals(list: Pedal[]) {
    const key = JSON.stringify(list);
    if (key === this.pedalKey) return;
    this.pedalKey = key;
    this.pedalIn.disconnect();
    for (const p of this.pedals) p.dispose();
    this.pedals = list.map((p) => makePedal(this.context, p));
    if (this.pedals.length) this.pedalIn.chain(...this.pedals, this.pedalOut);
    else this.pedalIn.connect(this.pedalOut);
    this.linkKey = ""; // cambió lo que hay dentro de la etapa
  }
  /** Conecta en serie los nodos de plugins (lista vacía = directo). */
  setPluginNodes(nodes: AudioNode[]) {
    this.plugIn.disconnect();
    this.plugCount = nodes.length;
    this.linkKey = "";
    if (!nodes.length) { this.plugIn.connect(this.plugOut); this.relink(); return; }
    Tone.connect(this.plugIn, nodes[0]);
    for (let i = 0; i + 1 < nodes.length; i++) { try { nodes[i].disconnect(); } catch { /* nada */ } nodes[i].connect(nodes[i + 1]); }
    const last = nodes[nodes.length - 1];
    try { last.disconnect(); } catch { /* nada */ }
    Tone.connect(last, this.plugOut);
    this.relink();
  }
  set level(v: number) { this.output.gain.value = v; }
  dispose() {
    this.eq.dispose();
    if (this.sending.r) this.buses.use("reverb", -1);
    if (this.sending.c) this.buses.use("chorus", -1);
    if (this.sending.d) this.buses.use("delay", -1);
    for (const n of [this.input, this.pre, this.shaper, this.post, this.hp, this.lp, this.comp, this.makeup, this.pedalIn, this.pedalOut, this.plugIn, this.plugOut, this.output, this.send, this.sendChorus, this.sendDelay, ...this.pedals]) n.dispose();
  }
}

// ---------- masterizado ----------
export class MasterChain {
  readonly input: Tone.Gain;
  private eq: Eq3; private glue: Tone.Compressor; private width: Tone.StereoWidener;
  private drive: Tone.Gain; private limiter: Tone.Limiter; private clip: Tone.WaveShaper;
  readonly output: Tone.Gain;
  constructor(context: Ctx, destination: Tone.InputNode) {
    const o = opt(context);
    this.input = new Tone.Gain(o);
    this.eq = new Eq3(context, 150, 5000);
    this.glue = new Tone.Compressor({ ...o, attack: 0.03, release: 0.25, knee: 10 });
    this.width = new Tone.StereoWidener({ ...o, width: 0.5 });
    this.drive = new Tone.Gain(o);
    this.limiter = new Tone.Limiter({ ...o, threshold: -1 });
    // El limitador deja pasar golpes muy rápidos: un recorte suave final asegura el techo de −0.8 dB.
    this.clip = new Tone.WaveShaper({ ...o });
    this.clip.curve = softClipCurve(); // (la opción «curve» del constructor de Tone se ignora)
    this.clip.oversample = "2x";
    this.output = new Tone.Gain(o);
    this.eq.hi.chain(this.glue, this.width, this.drive, this.limiter);
    this.limiter.chain(this.clip, this.output);
    this.output.connect(destination);
    this.set(null);
  }
  /** null = sin masterizar (solo un limitador suave que evita saturar la salida). */
  set(m: MasterFx | null) {
    const f = m ?? { preset: "", low: 5, mid: 5, high: 5, glue: 0, width: 5, loud: 0 };
    this.eq.set((f.low - 5) * 2, (f.mid - 5) * 2, (f.high - 5) * 2);
    this.glue.threshold.value = f.glue > 0 ? -4 - f.glue * 2.4 : 0;
    this.glue.ratio.value = f.glue > 0 ? 1.5 + f.glue * 0.35 : 1;
    this.width.width.value = Math.max(0, Math.min(1, f.width / 10));
    this.drive.gain.value = Tone.dbToGain(f.loud * 1.4); // hasta +14 dB contra el limitador
    this.limiter.threshold.value = m ? -0.8 : -1;
    // Sin masterizar no se procesan EQ, compresor ni ancho estéreo.
    const full = !!m;
    if (full !== this.full) {
      this.full = full;
      this.input.disconnect();
      if (full) this.input.connect(this.eq.lo);
      else { this.drive.disconnect(); this.drive.connect(this.limiter); this.input.connect(this.limiter); }
      if (full) { this.drive.disconnect(); this.drive.connect(this.limiter); }
    }
  }
  private full: boolean | null = null;
}

/** Lineal hasta 0.85; arriba se dobla suave hasta un máximo de 0.912 (−0.8 dBFS). */
function softClipCurve() {
  const n = 4096, c = new Float32Array(n), knee = 0.85, room = 0.912 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  }
  return c;
}

// ---------- buses compartidos ----------
export interface Buses { reverb: Tone.Gain; chorus: Tone.Gain; delay: Tone.Gain; use(bus: "reverb" | "chorus" | "delay", delta: 1 | -1): void }
/** Crea los tres buses de efectos de tiempo que comparten todas las pistas. Cada bus se conecta a la
 *  salida solo mientras alguna pista le envía algo: un bus sin uso no se procesa. */
export async function makeBuses(context: Ctx, out: Tone.InputNode): Promise<Buses> {
  const o = opt(context);
  const reverb = new Tone.Gain(o), chorus = new Tone.Gain(o), delay = new Tone.Gain(o);
  const r = await makeReverb(context, null);
  reverb.connect(r);
  const tails: Record<string, AudioNode | Tone.ToneAudioNode> = { reverb: r, chorus: chorusBus(context, chorus), delay: delayBus(context, delay) };
  const count: Record<string, number> = { reverb: 0, chorus: 0, delay: 0 };
  return {
    reverb, chorus, delay,
    use(bus, delta) {
      const before = count[bus];
      count[bus] = Math.max(0, before + delta);
      const tail = tails[bus];
      if (before === 0 && count[bus] > 0) Tone.connect(tail as AudioNode, out);
      else if (before > 0 && count[bus] === 0) setTimeout(() => { if (count[bus] === 0) try { tail.disconnect(); } catch { /* ya */ } }, 4000); // deja sonar la cola
    },
  };
}
/** Chorus estéreo con nodos nativos: dos retardos cortos modulados por un oscilador en contrafase. */
function chorusBus(context: Ctx, input: Tone.Gain): AudioNode {
  const raw = context.rawContext as unknown as BaseAudioContext;
  const dL = raw.createDelay(0.05), dR = raw.createDelay(0.05);
  dL.delayTime.value = 0.0045; dR.delayTime.value = 0.0055;
  const lfo = raw.createOscillator(); lfo.frequency.value = 0.9;
  const depL = raw.createGain(), depR = raw.createGain();
  depL.gain.value = 0.0025; depR.gain.value = -0.0025;
  lfo.connect(depL).connect(dL.delayTime); lfo.connect(depR).connect(dR.delayTime); lfo.start();
  const merge = raw.createChannelMerger(2);
  Tone.connect(input, dL); Tone.connect(input, dR);
  dL.connect(merge, 0, 0); dR.connect(merge, 0, 1);
  return merge;
}
/** Delay con realimentación y un filtro que oscurece cada repetición (nodos nativos). */
function delayBus(context: Ctx, input: Tone.Gain): AudioNode {
  const raw = context.rawContext as unknown as BaseAudioContext;
  const d = raw.createDelay(2); d.delayTime.value = 0.36;
  const fb = raw.createGain(); fb.gain.value = 0.38;
  const tone = raw.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 3800;
  Tone.connect(input, d);
  d.connect(tone).connect(fb).connect(d);
  return tone;
}

/** Bus de reverb compartido (sala generada, sin descargar respuestas de impulso). */
export async function makeReverb(context: Ctx, out: Tone.InputNode | null) {
  const r = new Tone.Reverb({ context, decay: LIGHT ? 1.3 : 2.6, preDelay: 0.02, wet: 1 });
  await r.ready;
  if (out) r.connect(out);
  return r;
}

// Banco de pruebas de rendimiento (solo con ?mfdebug en la dirección).
if (typeof location !== "undefined" && location.search.includes("mfdebug")) (window as unknown as Record<string, unknown>).__studio = { Tone, TrackChain, MasterChain, makeReverb, makeBuses, setLightAudio };
