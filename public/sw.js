// Service worker de MusicFees.
// 1) Aislamiento entre orígenes: añade a las páginas los encabezados COOP/COEP que GitHub Pages no manda.
//    Con ellos el navegador permite memoria compartida y la separación de pistas usa varios núcleos.
//    COEP «credentialless»: los recursos de otros sitios (fuentes, la nube) se piden sin credenciales y
//    siguen funcionando; no se rompe nada que ya funcionara.
// 2) Sin internet: guarda la app (HTML, JS, CSS, sonidos e íconos) para abrirla sin conexión. Los modelos
//    del transcriptor ya se guardan aparte, al bajarlos (no se duplican aquí).
const VERSION = "mf-sw-1";
const SHELL = `${VERSION}-app`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("mf-sw-") && !k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(res) {
  if (!res || res.status === 0 || res.type === "opaque" || res.type === "opaqueredirect") return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "credentialless");
  h.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // lo de otros sitios va directo
  if (url.pathname.includes("/models/")) return; // los modelos tienen su propio guardado
  const nav = req.mode === "navigate";
  const hashed = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(js|css|wasm)$/.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    if (hashed) {
      // Archivos con huella en el nombre: nunca cambian; primero lo guardado.
      const hit = await cache.match(req);
      if (hit) return isolate(hit);
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return isolate(res);
    }
    // Páginas y lo demás: primero la red (para tener siempre la versión nueva); sin red, lo guardado.
    try {
      const res = await fetch(req);
      if (res.ok && (nav || /\.(html|webmanifest|png|svg|woff2?|sf3|ogg|json)$/.test(url.pathname))) cache.put(req, res.clone());
      return isolate(res);
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: nav });
      if (hit) return isolate(hit);
      if (nav) { const home = await cache.match(new URL("./", self.registration.scope).href); if (home) return isolate(home); }
      throw err;
    }
  })());
});
