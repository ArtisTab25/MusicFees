// Guardado en Supabase + sesión en vivo para el dúo (Realtime broadcast y presencia).
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { ARTIFACT, NO_CLOUD_MSG, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
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

export interface Session { token: string; username: string; isAdmin: boolean }
export interface UserRow { id: string; username: string; is_admin: boolean; created_at: string; songs: number }
const SESSION_KEY = "mf:session";
export function loadSession(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); return s?.token ? s : null; } catch { return null; }
}
function saveSession(s: Session | null) {
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* nada */ }
}

export class Cloud {
  session: Session | null = loadSession();
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
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data: id, error } = await this.sb.rpc("mf_create_song", { p_title: title, p_data: data });
    if (error) throw this.explain(error);
    return id as string;
  }
  async get(id: string): Promise<SongRow | null> {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data, error } = await this.sb.rpc("mf_get_song", { p_id: id });
    if (error) throw this.explain(error);
    return (data as SongRow[])[0] ?? null;
  }
  async save(id: string, title: string, data: string): Promise<number> {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data: v, error } = await this.sb.rpc("mf_save_song", { p_id: id, p_title: title, p_data: data });
    if (error) throw this.explain(error);
    return Number(v);
  }
  // ---------- cuentas (002_cuentas.sql) ----------
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) {
      if (/function .*does not exist|schema cache|Could not find the function/i.test(error.message ?? "")) throw new Error("La base de datos todavía no tiene cuentas. Ejecuta supabase/migrations/002_cuentas.sql en Supabase.");
      if (/sesión terminó/i.test(error.message ?? "")) { this.session = null; saveSession(null); }
      throw this.explain(error);
    }
    return data as T;
  }
  private tok() { if (!this.session) throw new Error("Entra con tu cuenta primero."); return this.session.token; }
  needSetup() { return this.rpc<boolean>("mf_need_setup", {}); }
  private start(rows: { token: string; username: string; is_admin: boolean }[]) {
    const r = rows[0];
    this.session = { token: r.token, username: r.username, isAdmin: r.is_admin };
    saveSession(this.session);
    return this.session;
  }
  async setupAdmin(user: string, pass: string) { return this.start(await this.rpc("mf_setup_admin", { p_user: user, p_pass: pass })); }
  async login(user: string, pass: string) { return this.start(await this.rpc("mf_login", { p_user: user, p_pass: pass })); }
  async logout() {
    const t = this.session?.token;
    this.session = null; saveSession(null);
    if (t) await this.sb.rpc("mf_logout", { p_token: t }).then(() => {}, () => {});
  }
  users() { return this.rpc<UserRow[]>("mf_admin_users", { p_token: this.tok() }); }
  createUser(user: string, pass: string, admin = false) { return this.rpc<string>("mf_admin_create_user", { p_token: this.tok(), p_user: user, p_pass: pass, p_admin: admin }); }
  setPassword(id: string, pass: string) { return this.rpc<void>("mf_admin_set_password", { p_token: this.tok(), p_id: id, p_pass: pass }); }
  deleteUser(id: string) { return this.rpc<void>("mf_admin_delete_user", { p_token: this.tok(), p_id: id }); }
  mySongs() { return this.rpc<{ id: string; title: string; updated_at: string; size: number }[]>("mf_my_songs", { p_token: this.tok() }); }
  createMine(title: string, data: string) { return this.rpc<string>("mf_create_my_song", { p_token: this.tok(), p_title: title, p_data: data }); }
  claim(id: string) { return this.rpc<void>("mf_claim_song", { p_token: this.tok(), p_id: id }); }
  deleteMine(id: string) { return this.rpc<void>("mf_delete_my_song", { p_token: this.tok(), p_id: id }); }

  async list(ids: string[]) {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
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
