// Plugins de terceros con el estándar Web Audio Modules 2.0 (WAM). Cada plugin es un módulo
// JavaScript que se importa en tiempo de ejecución y crea un nodo de audio dentro de nuestro
// contexto, con su propia interfaz. Los WAM necesitan un contexto de audio nativo.
import { initializeWamHost } from "@webaudiomodules/sdk";
import type { PluginRef } from "../score/model";

/** Plugins incluidos (MIT, Burns Audio / Sequencer Party; ver public/wam/NOTICE.txt). */
export const WAM_CATALOG: { src: string; name: string; note: string }[] = [
  { src: "wam/distortion/index.js", name: "Simple Distortion", note: "Distorsión por curva, con nivel y sabor" },
  { src: "wam/delay/index.js", name: "Delay", note: "Delay estéreo con filtros y ping-pong" },
  { src: "wam/simpleEQ/index.js", name: "Simple EQ", note: "Ecualizador de 3 bandas con frecuencias ajustables" },
];

export interface WamInstance {
  audioNode: AudioNode & { getState(): Promise<unknown>; setState(s: unknown): Promise<void>; destroy?(): void };
  createGui(): Promise<HTMLElement>;
  destroyGui?(gui: HTMLElement): void;
}

const hosts = new WeakMap<BaseAudioContext, Promise<string>>();
function host(ctx: BaseAudioContext) {
  let h = hosts.get(ctx);
  if (!h) { h = initializeWamHost(ctx).then(([groupId]) => groupId); hosts.set(ctx, h); }
  return h;
}
/** Dirección absoluta del módulo: los del catálogo se sirven junto a la app. */
export const pluginUrl = (src: string) => (/^https?:\/\//.test(src) ? src : new URL(`${import.meta.env.BASE_URL}${src}`, location.href).href);

export async function createPlugin(ctx: BaseAudioContext, ref: PluginRef): Promise<WamInstance> {
  const groupId = await host(ctx);
  const mod = await import(/* @vite-ignore */ pluginUrl(ref.src));
  const WAM = mod.default;
  if (!WAM?.createInstance) throw new Error(`«${ref.name}» no es un plugin WAM 2.0.`);
  const inst = (await WAM.createInstance(groupId, ctx)) as WamInstance;
  if (ref.state) await inst.audioNode.setState(ref.state);
  return inst;
}
/** Lee el nombre del plugin de su descriptor (para plugins agregados por dirección). */
export async function pluginName(src: string): Promise<string> {
  try {
    const r = await fetch(pluginUrl(src).replace(/index\.js$/, "descriptor.json"));
    if (r.ok) { const d = await r.json(); if (d?.name) return String(d.name); }
  } catch { /* sin descriptor */ }
  return src.split("/").slice(-2, -1)[0] || "Plugin";
}
