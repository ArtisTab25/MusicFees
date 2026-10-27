// Historial de versiones y papelera, guardados en este dispositivo (IndexedDB: cabe mucho más que en
// localStorage). Las versiones se toman solas cada 10 minutos de edición, o cuando el usuario pide.
// La papelera guarda la canción completa durante 30 días antes de borrarla de verdad.

const DB = "musicfees", STORE_V = "versions", STORE_T = "trash";
const KEEP_VERSIONS = 20, AUTO_EVERY = 10 * 60_000, TRASH_DAYS = 30;

export interface Version { id: string; song: string; t: number; title: string; label: string; auto: boolean; json: string }
export interface TrashItem { id: string; song: string; t: number; title: string; cloud: boolean; json: string }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(STORE_V)) d.createObjectStore(STORE_V, { keyPath: "id" }).createIndex("song", "song");
      if (!d.objectStoreNames.contains(STORE_T)) d.createObjectStore(STORE_T, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? (req.result as T) : undefined);
    t.onerror = () => rej(t.error);
  }));
}

// ---------- versiones ----------
export async function versions(song: string): Promise<Version[]> {
  const all = (await tx<Version[]>(STORE_V, "readonly", (s) => s.index("song").getAll(song))) ?? [];
  return all.sort((a, b) => b.t - a.t);
}
export async function addVersion(song: string, title: string, json: string, label = "", auto = false) {
  const list = await versions(song);
  if (auto && list.length && (Date.now() - list[0].t < AUTO_EVERY || list[0].json === json)) return false;
  const v: Version = { id: crypto.randomUUID(), song, t: Date.now(), title, label, auto, json };
  await tx(STORE_V, "readwrite", (s) => { s.put(v); });
  // Guarda las 20 más recientes (las que tienen nombre no se borran solas).
  const old = [v, ...list].filter((x) => x.auto).slice(KEEP_VERSIONS);
  if (old.length) await tx(STORE_V, "readwrite", (s) => { for (const o of old) s.delete(o.id); });
  return true;
}
export const deleteVersion = (id: string) => tx(STORE_V, "readwrite", (s) => { s.delete(id); });

// ---------- papelera ----------
export async function trash(item: Omit<TrashItem, "id" | "t">) {
  await tx(STORE_T, "readwrite", (s) => { s.put({ ...item, id: crypto.randomUUID(), t: Date.now() }); });
}
export async function trashList(): Promise<TrashItem[]> {
  const all = (await tx<TrashItem[]>(STORE_T, "readonly", (s) => s.getAll())) ?? [];
  const limit = Date.now() - TRASH_DAYS * 86_400_000;
  const expired = all.filter((x) => x.t < limit);
  if (expired.length) await tx(STORE_T, "readwrite", (s) => { for (const x of expired) s.delete(x.id); });
  return all.filter((x) => x.t >= limit).sort((a, b) => b.t - a.t);
}
export const deleteTrash = (id: string) => tx(STORE_T, "readwrite", (s) => { s.delete(id); });

// ---------- cambios que aún no llegan a la nube ----------
const PENDING = "mf:pending";
function pendingMap(): Record<string, number> { try { return JSON.parse(localStorage.getItem(PENDING) || "{}"); } catch { return {}; } }
function writePending(m: Record<string, number>) { try { localStorage.setItem(PENDING, JSON.stringify(m)); } catch { /* lleno */ } }
export function markPending(song: string) { const m = pendingMap(); m[song] = Date.now(); writePending(m); }
export function clearPending(song: string) { const m = pendingMap(); delete m[song]; writePending(m); }
export const pendingSince = (song: string): number | null => pendingMap()[song] ?? null;
