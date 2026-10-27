// Acercar y alejar la partitura con dos dedos (y con Ctrl + rueda o el pellizco del trackpad).
// Mientras los dedos se mueven solo se escala la imagen ya dibujada (barato y fluido); al soltar se
// vuelve a dibujar una sola vez con el tamaño nuevo y se acomoda el desplazamiento para que el punto
// que estaba entre los dedos quede en el mismo lugar.
export interface PinchHooks {
  /** Escala actual de la partitura. */
  scale(): number;
  /** Dibuja con la escala nueva; resuelve cuando terminó de dibujar. */
  apply(scale: number): Promise<void>;
  /** Se llama al empezar (para cancelar toques pendientes y ocultar el cursor). */
  start(): void;
  end(): void;
  /** Recuerda qué hay bajo los dedos (antes de escalar), para devolverlo al mismo lugar después de
   *  volver a dibujar. En vista de página los renglones se reacomodan al cambiar el tamaño, así que
   *  una regla de tres no basta. */
  anchor?(fx: number, fy: number): unknown;
  /** Desplaza para que lo anclado quede en (fx, fy) de la ventana. false si no pudo. */
  place?(a: unknown, fx: number, fy: number): boolean;
}
export const ZOOM_MIN = 0.4, ZOOM_MAX = 2.5;
const clamp = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 20) / 20));

export function attachPinch(wrap: HTMLElement, content: HTMLElement, hooks: PinchHooks) {
  let g: { d0: number; base: number; px: number; py: number; fx: number; fy: number; ratio: number; a?: unknown } | null = null;
  let busy = false;
  /** El último pellizco terminó hace poco: el «pointerup» de esos dedos no debe contar como toque. */
  let lastEnd = 0;

  const focal = (cx: number, cy: number) => {
    const r = wrap.getBoundingClientRect();
    const fx = cx - r.left, fy = cy - r.top; // punto en la ventana del contenedor
    // Punto en coordenadas del contenido (antes de escalar)
    return { fx, fy, px: fx + wrap.scrollLeft - content.offsetLeft, py: fy + wrap.scrollTop - content.offsetTop };
  };
  const preview = (ratio: number) => {
    if (!g) return;
    content.style.transformOrigin = `${g.px}px ${g.py}px`;
    content.style.transform = `scale(${ratio})`;
  };
  const finish = async (ratio: number, at: { px: number; py: number; fx: number; fy: number; a?: unknown }) => {
    const base = hooks.scale();
    const z = clamp(base * ratio);
    if (Math.abs(z - base) < 0.01 || busy) { content.style.transform = ""; hooks.end(); return; }
    busy = true;
    const real = z / base;
    try {
      await hooks.apply(z);
      // El punto que estaba bajo los dedos queda en el mismo lugar de la pantalla.
      content.style.transform = "";
      if (!(at.a && hooks.place?.(at.a, at.fx, at.fy))) {
        wrap.scrollLeft = Math.max(0, at.px * real + content.offsetLeft - at.fx);
        wrap.scrollTop = Math.max(0, at.py * real + content.offsetTop - at.fy);
      }
    } finally {
      content.style.transform = "";
      busy = false;
      hooks.end();
    }
  };

  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2 || busy) return;
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const f = focal(cx, cy);
    g = { d0: Math.max(10, dist(e.touches)), base: hooks.scale(), ratio: 1, ...f, a: hooks.anchor?.(f.fx, f.fy) };
    hooks.start();
  }, { passive: true });
  wrap.addEventListener("touchmove", (e) => {
    if (!g || e.touches.length < 2) return;
    e.preventDefault(); // que el navegador no desplace mientras se pellizca
    const r = clamp(g.base * (dist(e.touches) / g.d0)) / g.base;
    g.ratio = r;
    preview(r);
  }, { passive: false });
  const touchEnd = (e: TouchEvent) => {
    if (!g || e.touches.length >= 2) return;
    const done = g;
    g = null;
    lastEnd = Date.now();
    void finish(done.ratio, done);
  };
  wrap.addEventListener("touchend", touchEnd);
  wrap.addEventListener("touchcancel", touchEnd);

  // Computadora: Ctrl + rueda, o el pellizco del trackpad (llega como rueda con Ctrl).
  let wheelRatio = 1, wheelT = 0, wheelAt: (ReturnType<typeof focal> & { a?: unknown }) | null = null;
  wrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || busy) return;
    e.preventDefault();
    if (!wheelAt) { const f = focal(e.clientX, e.clientY); wheelAt = { ...f, a: hooks.anchor?.(f.fx, f.fy) }; hooks.start(); g = { d0: 1, base: hooks.scale(), ratio: 1, ...wheelAt }; }
    wheelRatio = clamp(hooks.scale() * wheelRatio * Math.exp(-e.deltaY * 0.01)) / hooks.scale();
    preview(wheelRatio);
    clearTimeout(wheelT);
    wheelT = window.setTimeout(() => {
      const at = wheelAt!, r = wheelRatio;
      wheelAt = null; wheelRatio = 1; g = null;
      void finish(r, at);
    }, 220);
  }, { passive: false });

  return {
    /** true mientras se pellizca o justo después (para ignorar el toque de esos dedos). */
    get active() { return !!g || busy || Date.now() - lastEnd < 350; },
  };
}
