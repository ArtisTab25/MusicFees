// Plugins sin internet: descarga todos los archivos de public/wam (lista wam/files.json, hecha al compilar)
// al almacén del service worker. Sin red, el service worker los sirve desde ahí.
import { ARTIFACT } from "../config";

export interface WamFiles { files: [string, number][]; bytes: number; v: string }
const KEY = "mf:wamOffline";

async function shellCache(): Promise<Cache | null> {
  if (!("caches" in self)) return null;
  const k = (await caches.keys()).filter((x) => /^mf-sw-\d+-app$/.test(x)).sort().pop();
  return k ? caches.open(k) : null;
}

/** Se puede usar aquí (web con service worker; no en el artefacto ni en la app de Android). */
export const offlinePluginsAvailable = (native: boolean) => !ARTIFACT && !native && "serviceWorker" in navigator && !!navigator.serviceWorker.controller;

export async function wamList(): Promise<WamFiles | null> {
  try { const r = await fetch(`${import.meta.env.BASE_URL}wam/files.json`, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}

/** ¿Ya está todo guardado (y es la misma versión de los plugins)? */
export function savedVersion(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }

export async function downloadPlugins(list: WamFiles, progress: (done: number, total: number) => void): Promise<number> {
  const cache = await shellCache();
  if (!cache) throw new Error("El guardado sin internet todavía no está listo: recarga la página y vuelve a intentar.");
  let done = 0, failed = 0;
  const base = new URL(import.meta.env.BASE_URL, location.href);
  for (let i = 0; i < list.files.length; i += 6) {
    await Promise.all(list.files.slice(i, i + 6).map(async ([f, b]) => {
      const u = new URL(f, base).href;
      try {
        if (!(await cache.match(u, { ignoreVary: true }))) { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); await cache.put(u, r); }
      } catch { failed++; }
      done += b; progress(done, list.bytes);
    }));
  }
  if (!failed) try { localStorage.setItem(KEY, list.v); } catch { /* sin almacenamiento */ }
  return failed;
}
