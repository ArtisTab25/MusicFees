// Guardado en Supabase + sesión en vivo para el dúo (Realtime broadcast y presencia).
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import type { Op } from "../score/model";

export interface SongRow { id: string; title: string; data: string; version: number; updated_at: string }
export interface Peer { key: string; name: string; color: string; cursor?: { t: number; b: number; i: number; row: number } }

const LOCAL_LIST = "mf:songs";
const LOCAL_DOC = (id: string) => `mf:doc:${id}`;
export const clientId = (() => {
  try {
    let id = localStorage.getItem("mf:client");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("mf:client", id); }
    return id;
  } catch { return crypto.randomUUID(); }
})();

export interface LocalEntry { id: string; title: string; updated: number; cloud: boolean }
export function localList(): LocalEntry[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_LIST) || "[]"); } catch { return []; }
}
function saveLocalList(list: LocalEntry[]) {
  try { localStorage.setItem(LOCAL_LIST, JSON.stringify(list.slice(0, 200))); } catch { /* lleno */ }
}
export function rememberSong(e: LocalEntry) {
  const list = localList().filter((x) => x.id !== e.id);
  list.unshift(e);
  saveLocalList(list);
}
export function forgetSong(id: string) {
  saveLocalList(localList().filter((x) => x.id !== id));
  try { localStorage.removeItem(LOCAL_DOC(id)); } catch { /* nada */ }
}
export function saveLocalDoc(id: string, json: string) {
  try { localStorage.setItem(LOCAL_DOC(id), json); } catch { /* sin espacio: queda solo en la nube */ }
}
export function loadLocalDoc(id: string): string | null {
  try { return localStorage.getItem(LOCAL_DOC(id)); } catch { return null; }
}

export class Cloud {
  sb: SupabaseClient;
  ok = true;
  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  }
  private explain(e: { message?: string; code?: string } | null): Error {
    const m = e?.message ?? "";
    if (/mf_|function|schema cache|does not exist/i.test(m))
      return new Error("La base de datos aún no está preparada. Ejecuta supabase/migrations/001_musicfees.sql en Supabase.");
    if (/fetch|network|Failed/i.test(m)) return new Error("Sin conexión con la nube. Se guardó en este teléfono.");
    return new Error(m || "Error de la nube");
  }
  async create(title: string, data: string): Promise<string> {
    const { data: id, error } = await this.sb.rpc("mf_create_song", { p_title: title, p_data: data });
    if (error) throw this.explain(error);
    return id as string;
  }
  async get(id: string): Promise<SongRow | null> {
    const { data, error } = await this.sb.rpc("mf_get_song", { p_id: id });
    if (error) throw this.explain(error);
    return (data as SongRow[])[0] ?? null;
  }
  async save(id: string, title: string, data: string): Promise<number> {
    const { data: v, error } = await this.sb.rpc("mf_save_song", { p_id: id, p_title: title, p_data: data });
    if (error) throw this.explain(error);
    return Number(v);
  }
  async list(ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.sb.rpc("mf_list_songs", { p_ids: ids });
    if (error) throw this.explain(error);
    return data as { id: string; title: string; updated_at: string }[];
  }
}

/** Canal en vivo de una canción: operaciones, cursores y presencia del dúo. */
export class LiveSession {
  channel: RealtimeChannel;
  peers: Peer[] = [];
  connected = false;
  onOps: (ops: Op[], from: string) => void = () => {};
  onPeers: (peers: Peer[]) => void = () => {};
  onCursor: (key: string, c: Peer["cursor"]) => void = () => {};
  onSnapshotRequest: (from: string) => void = () => {};
  onSnapshot: (json: string) => void = () => {};
  onReloadHint: () => void = () => {};
  private me: Peer;

  constructor(cloud: Cloud, public songId: string, name: string, color: string) {
    this.me = { key: clientId, name, color };
    this.channel = cloud.sb.channel(`mf-song-${songId}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: clientId } },
    });
    this.channel
      .on("broadcast", { event: "ops" }, ({ payload }) => this.onOps(payload.ops as Op[], payload.from))
      .on("broadcast", { event: "cursor" }, ({ payload }) => this.onCursor(payload.from, payload.c))
      .on("broadcast", { event: "hello" }, ({ payload }) => this.onSnapshotRequest(payload.from))
      .on("broadcast", { event: "snapshot" }, ({ payload }) => { if (payload.to === clientId) this.onSnapshot(payload.json); })
      .on("broadcast", { event: "reload" }, ({ payload }) => { if (!payload.to || payload.to === clientId) this.onReloadHint(); })
      .on("presence", { event: "sync" }, () => {
        const st = this.channel.presenceState<Peer>();
        this.peers = Object.values(st).map((arr) => arr[0]).filter(Boolean);
        this.onPeers(this.peers);
      })
      .subscribe(async (status) => {
        this.connected = status === "SUBSCRIBED";
        if (this.connected) {
          await this.channel.track(this.me);
          this.channel.send({ type: "broadcast", event: "hello", payload: { from: clientId } });
        }
      });
  }
  /** El anfitrión es quien guarda en la base mientras ambos están conectados. */
  get isHost() {
    const keys = this.peers.map((p) => p.key).sort();
    return !keys.length || keys[0] === clientId;
  }
  get others() { return this.peers.filter((p) => p.key !== clientId); }
  sendOps(ops: Op[]) {
    if (!this.connected) return;
    const payload = { ops, from: clientId };
    // Los mensajes grandes (deshacer de canciones largas) van como aviso de recarga.
    if (JSON.stringify(payload).length > 180_000) {
      this.channel.send({ type: "broadcast", event: "reload", payload: {} });
      return;
    }
    this.channel.send({ type: "broadcast", event: "ops", payload });
  }
  sendCursor(c: Peer["cursor"]) {
    if (this.connected) this.channel.send({ type: "broadcast", event: "cursor", payload: { from: clientId, c } });
  }
  sendSnapshot(to: string, json: string) {
    if (!this.connected) return;
    if (json.length > 180_000) this.channel.send({ type: "broadcast", event: "reload", payload: { to } });
    else this.channel.send({ type: "broadcast", event: "snapshot", payload: { to, json } });
  }
  async close() { await this.channel.unsubscribe(); }
}
