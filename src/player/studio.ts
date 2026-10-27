// Cadenas de efectos construidas con Tone.js (MIT). Las usa el motor en vivo y la exportación
// de audio (en un contexto sin conexión), así lo que se oye es lo que se graba.
//
// Pista:   entrada → amplificador (ganancia + distorsión + gabinete) → EQ de 3 bandas → compresor
//          → pedales en serie (phaser, trémolo, wah…) → chorus → delay → salida (+ envío a reverb)
// Master:  suma → EQ → compresor «pegamento» → ancho estéreo → volumen → limitador → salida
import * as Tone from "tone";
import type { MasterFx, Pedal, TrackFx } from "../score/model";
import { octaveSemis } from "./fxPresets";

type Ctx = Tone.BaseContext;
const opt = (context: Ctx) => ({ context });
const flat: TrackFx = { preset: "", drive: 0, low: 5, mid: 5, high: 5, comp: 0, chorus: 0, delay: 0, reverb: 0 };

// ---------- pedales ----------
function makePedal(context: Ctx, p: Pedal): Tone.ToneAudioNode {
  const a = p.a / 10, b = p.b / 10, wet = p.mix / 10;
  let n: Tone.ToneAudioNode & { wet: Tone.Signal<"normalRange"> };
  switch (p.type) {
    case "phaser": n = new Tone.Phaser({ ...opt(context), frequency: 0.15 + a * 3, octaves: 1 + b * 4, baseFrequency: 350 }); break;
    case "tremolo": n = new Tone.Tremolo({ ...opt(context), frequency: 1 + a * 9, depth: b, spread: 0 }).start(); break;
    case "wah": n = new Tone.AutoWah({ ...opt(context), baseFrequency: 80 + a * 300, octaves: 5, sensitivity: -40 + b * 30, Q: 3 }); break;
    case "autofilter": n = new Tone.AutoFilter({ ...opt(context), frequency: 0.2 + a * 6, depth: b, baseFrequency: 200, octaves: 3.5 }).start(); break;
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
  private hp: Tone.Filter; private lp: Tone.Filter; private eq: Tone.EQ3;
  private comp: Tone.Compressor; private makeup: Tone.Gain;
  private pedalIn: Tone.Gain; private pedalOut: Tone.Gain; private pedals: Tone.ToneAudioNode[] = [];
  /** Plugins WAM (nodos nativos) entre los pedales y el chorus. */
  private plugIn: Tone.Gain; private plugOut: Tone.Gain;
  private pedalKey = "";
  private chorus: Tone.Chorus; private delay: Tone.FeedbackDelay;

  constructor(private context: Ctx, reverbBus: Tone.InputNode, masterIn: Tone.InputNode) {
    const o = opt(context);
    this.input = new Tone.Gain(o); this.output = new Tone.Gain(o); this.send = new Tone.Gain({ ...o, gain: 0 });
    this.pre = new Tone.Gain(o); this.post = new Tone.Gain(o);
    this.shaper = new Tone.WaveShaper({ ...o });
    this.shaper.oversample = "4x";
    this.hp = new Tone.Filter({ ...o, type: "highpass", frequency: 20, rolloff: -12 });
    this.lp = new Tone.Filter({ ...o, type: "lowpass", frequency: 20000, rolloff: -24 });
    this.eq = new Tone.EQ3({ ...o, lowFrequency: 200, highFrequency: 3200 });
    this.comp = new Tone.Compressor({ ...o, attack: 0.005, release: 0.15 });
    this.makeup = new Tone.Gain(o);
    this.pedalIn = new Tone.Gain(o); this.pedalOut = new Tone.Gain(o);
    this.plugIn = new Tone.Gain(o); this.plugOut = new Tone.Gain(o);
    this.chorus = new Tone.Chorus({ ...o, frequency: 0.9, delayTime: 3.5, depth: 0.6, wet: 0 }).start();
    this.delay = new Tone.FeedbackDelay({ ...o, delayTime: 0.36, feedback: 0.3, wet: 0 });
    this.input.chain(this.pre, this.shaper, this.post, this.hp, this.lp, this.eq, this.comp, this.makeup, this.pedalIn);
    this.pedalIn.connect(this.pedalOut);
    this.pedalOut.connect(this.plugIn);
    this.plugIn.connect(this.plugOut);
    this.plugOut.chain(this.chorus, this.delay, this.output);
    this.output.connect(masterIn);
    this.output.connect(this.send);
    this.send.connect(reverbBus);
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
    this.hp.frequency.value = d > 0 ? 85 : 20;
    this.lp.frequency.value = d > 0 ? 5200 - d * 1400 : 20000;
    this.eq.low.value = (f.low - 5) * 2.5;
    this.eq.mid.value = (f.mid - 5) * 2.5;
    this.eq.high.value = (f.high - 5) * 2.5;
    this.comp.threshold.value = f.comp > 0 ? -6 - f.comp * 3 : 0;
    this.comp.ratio.value = f.comp > 0 ? 1 + f.comp * 0.9 : 1;
    this.makeup.gain.value = 1 + f.comp * 0.07;
    this.chorus.wet.value = (f.chorus / 10) * 0.6;
    this.delay.wet.value = (f.delay / 10) * 0.45;
    this.delay.feedback.value = 0.22 + (f.delay / 10) * 0.3;
    this.send.gain.value = (f.reverb / 10) * 0.7;
    this.setPedals(f.pedals ?? []);
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
  }
  /** Conecta en serie los nodos de plugins (lista vacía = directo). */
  setPluginNodes(nodes: AudioNode[]) {
    this.plugIn.disconnect();
    if (!nodes.length) { this.plugIn.connect(this.plugOut); return; }
    Tone.connect(this.plugIn, nodes[0]);
    for (let i = 0; i + 1 < nodes.length; i++) { try { nodes[i].disconnect(); } catch { /* nada */ } nodes[i].connect(nodes[i + 1]); }
    const last = nodes[nodes.length - 1];
    try { last.disconnect(); } catch { /* nada */ }
    Tone.connect(last, this.plugOut);
  }
  set level(v: number) { this.output.gain.value = v; }
  dispose() {
    for (const n of [this.input, this.pre, this.shaper, this.post, this.hp, this.lp, this.eq, this.comp, this.makeup, this.pedalIn, this.pedalOut, this.plugIn, this.plugOut, this.chorus, this.delay, this.output, this.send, ...this.pedals]) n.dispose();
  }
}

// ---------- masterizado ----------
export class MasterChain {
  readonly input: Tone.Gain;
  private eq: Tone.EQ3; private glue: Tone.Compressor; private width: Tone.StereoWidener;
  private drive: Tone.Gain; private limiter: Tone.Limiter; private clip: Tone.WaveShaper;
  readonly output: Tone.Gain;
  constructor(context: Ctx, destination: Tone.InputNode) {
    const o = opt(context);
    this.input = new Tone.Gain(o);
    this.eq = new Tone.EQ3({ ...o, lowFrequency: 150, highFrequency: 5000 });
    this.glue = new Tone.Compressor({ ...o, attack: 0.03, release: 0.25, knee: 10 });
    this.width = new Tone.StereoWidener({ ...o, width: 0.5 });
    this.drive = new Tone.Gain(o);
    this.limiter = new Tone.Limiter({ ...o, threshold: -1 });
    // El limitador deja pasar golpes muy rápidos: un recorte suave final asegura el techo de −0.8 dB.
    this.clip = new Tone.WaveShaper({ ...o });
    this.clip.curve = softClipCurve(); // (la opción «curve» del constructor de Tone se ignora)
    this.clip.oversample = "2x";
    this.output = new Tone.Gain(o);
    this.input.chain(this.eq, this.glue, this.width, this.drive, this.limiter, this.clip, this.output);
    this.output.connect(destination);
    this.set(null);
  }
  /** null = sin masterizar (solo un limitador suave que evita saturar la salida). */
  set(m: MasterFx | null) {
    const f = m ?? { preset: "", low: 5, mid: 5, high: 5, glue: 0, width: 5, loud: 0 };
    this.eq.low.value = (f.low - 5) * 2;
    this.eq.mid.value = (f.mid - 5) * 2;
    this.eq.high.value = (f.high - 5) * 2;
    this.glue.threshold.value = f.glue > 0 ? -4 - f.glue * 2.4 : 0;
    this.glue.ratio.value = f.glue > 0 ? 1.5 + f.glue * 0.35 : 1;
    this.width.width.value = Math.max(0, Math.min(1, f.width / 10));
    this.drive.gain.value = Tone.dbToGain(f.loud * 1.4); // hasta +14 dB contra el limitador
    this.limiter.threshold.value = m ? -0.8 : -1;
  }
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

/** Bus de reverb compartido (sala generada, sin descargar respuestas de impulso). */
export async function makeReverb(context: Ctx, out: Tone.InputNode) {
  const r = new Tone.Reverb({ context, decay: 2.6, preDelay: 0.02, wet: 1 });
  await r.ready;
  r.connect(out);
  return r;
}
