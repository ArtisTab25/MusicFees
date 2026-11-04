// Service worker de MusicFees.
// 1) Aislamiento entre orígenes: añade a las páginas los encabezados COOP/COEP que GitHub Pages no manda.
//    Con ellos el navegador permite memoria compartida y la separación de pistas usa varios núcleos.
//    COEP «credentialless»: los recursos de otros sitios (fuentes, la nube) se piden sin credenciales y
//    siguen funcionando; no se rompe nada que ya funcionara.
// 2) Sin internet: al instalarse guarda la app entera (precache.json: código, fuente musical, modelo de notas
//    y su motor WebAssembly), así se puede abrir y transcribir sin conexión aunque nunca se haya usado el
//    transcriptor con internet. Los modelos grandes de separación (Demucs, MDX, ONNX Runtime, Beat This!) se
//    guardan aparte al bajarlos (no se duplican aquí).
const VERSION = "mf-sw-2";
const SHELL = `${VERSION}-app`;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    try {
      const list = await (await fetch(new URL("precache.json", self.registration.scope), { cache: "no-store" })).json();
      const cache = await caches.open(SHELL);
      // de a pocos: si uno falla, los demás se guardan igual
      for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async (f) => {
        const u = new URL(f, self.registration.scope).href;
        if (await cache.match(u)) return;
        try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) await cache.put(u, r); } catch { /* se guardará al usarse */ }
      }));
    } catch { /* sin lista (desarrollo): se guarda lo que se vaya usando */ }
  })());
});
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
  if (/\/models\/(mdx|demucs|ort|beatthis)\//.test(url.pathname)) return; // modelos grandes: guardado propio
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
      if (res.ok && (nav || /\.(html|webmanifest|png|svg|woff2?|sf3|ogg|json|bin|wasm|otf)$/.test(url.pathname))) cache.put(req, res.clone());
      return isolate(res);
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: nav });
      if (hit) return isolate(hit);
      if (nav) { const home = await cache.match(new URL("./", self.registration.scope).href); if (home) return isolate(home); }
      throw err;
    }
  })());
});
