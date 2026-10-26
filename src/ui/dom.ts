// Utilidades mínimas de DOM e íconos (SVG en línea, sin dependencias).
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props)
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "class") el.className = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  append(el, children);
  return el;
}
function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

const P: Record<string, string> = {
  play: "M7 4v16l13-8z",
  pause: "M6 4h4v16H6zm8 0h4v16h-4z",
  prev: "M6 5h2v14H6zm3 7 10-7v14z",
  next: "M16 5h2v14h-2zM5 5l10 7-10 7z",
  home: "M12 3 2 12h3v8h5v-6h4v6h5v-8h3z",
  undo: "M12.5 8c-2.6 0-5 1-6.9 2.6L2 7v9h9l-3.6-3.6c1.4-1.2 3.1-1.9 5.1-1.9 3.5 0 6.5 2.3 7.6 5.5l2.4-.8C21.1 11 17.2 8 12.5 8z",
  redo: "M18.4 10.6C16.6 9 14.1 8 11.5 8 6.8 8 2.9 11 1.5 15.2l2.4.8c1.1-3.2 4.1-5.5 7.6-5.5 2 0 3.7.7 5.1 1.9L13 16h9V7z",
  zoomIn: "M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14zm2.5-5h-2V7H9v2H7v1h2v2h1v-2h2z",
  zoomOut: "M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14zM7 9h5v1H7z",
  page: "M6 2h9l5 5v15H6zm8 1.5V8h4.5z",
  scroll: "M2 7h20v10H2zm2 2v6h16V9z",
  keyboard: "M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2zm0 3h2v2h-2zM8 8h2v2H8zm0 3h2v2H8zm-1 2H5v-2h2zm0-3H5V8h2zm9 7H8v-2h8zm0-4h-2v-2h2zm0-3h-2V8h2zm3 3h-2v-2h2zm0-3h-2V8h2z",
  loop: "M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z",
  metro: "M12 1.8 7 3l-4 18h18L17 3zm.9 2.2 2.6.6.8 3.6-3.4 3.4zM6.2 19 9.4 5l1.6-.4v8.5l-1.7 1.7.7.7 5.6-5.6L18.8 19z",
  countin: "M6 2h12v2l-4.5 6.5V12l4.5 6.5V22H6v-3.5L10.5 12v-1.5L6 4z",
  mic: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.3-3a5.3 5.3 0 0 1-10.6 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z",
  grid: "M3 3h18v18H3zm2 2v3h3V5zm5 0v3h4V5zm6 0v3h3V5zM5 10v4h3v-4zm5 0v4h4v-4zm6 0v4h3v-4zM5 16v3h3v-3zm5 0v3h4v-3zm6 0v3h3v-3z",
  wave: "M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0l2 0v2c-2 4-4 4-6 0s-4-4-6 0-4 4-6 0z",
  eye: "M12 5C7 5 2.7 8.1 1 12.5 2.7 16.9 7 20 12 20s9.3-3.1 11-7.5C21.3 8.1 17 5 12 5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  mute: "M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z",
  solo: "M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z",
  plus: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z",
  trash: "M7 4V2h10v2h5v2H2V4zm-2 4h14l-1 14H6z",
  up: "M12 6 4 14l1.4 1.4L12 8.8l6.6 6.6L20 14z",
  down: "M12 18 4 10l1.4-1.4 6.6 6.6 6.6-6.6L20 10z",
  close: "M18.3 5.7 16.9 4.3 12 9.2 7.1 4.3 5.7 5.7 10.6 10.6 5.7 15.5 7.1 16.9 12 12l4.9 4.9 1.4-1.4-4.9-4.9z",
  share: "M18 16a3 3 0 0 0-2.4 1.2L8.9 13.7a3 3 0 0 0 0-1.4l6.7-3.5A3 3 0 1 0 15 7l-6.7 3.5a3 3 0 1 0 0 4l6.7 3.5A3 3 0 1 0 18 16z",
  tracks: "M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z",
  sliders: "M4 4h2v7H4zm0 11h2v5H4zm-2-3h6v2H2zm9-8h2v3h-2zm0 7h2v9h-2zm-2-3h6v2H9zm9-4h2v9h-2zm0 13h2v3h-2zm-2-3h6v2h-6z",
  chevronUp: "M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z",
  chevronDown: "M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z",
  file: "M6 2h8l6 6v14H6zm7 1.5V9h5.5z",
  guitar: "M19.6 2.4 17 5l-.6-.6-1.4 1.4.6.6-3 3a4.5 4.5 0 0 0-5 1L4 14a4.2 4.2 0 0 0 6 6l3-3.6a4.5 4.5 0 0 0 1-5l3-3 .6.6 1.4-1.4-.6-.6 2.6-2.6zM8.5 17A1.5 1.5 0 1 1 10 15.5 1.5 1.5 0 0 1 8.5 17z",
  piano: "M3 3h18v18H3zm2 2v14h3v-5H7V5zm5 0v9h-1v5h6v-5h-1V5h-1v9h-1V5zm6 0v9h-1v5h3V5z",
  drum: "M12 4C6.5 4 2 5.8 2 8v8c0 2.2 4.5 4 10 4s10-1.8 10-4V8c0-2.2-4.5-4-10-4zm0 2c4.4 0 8 1.3 8 2s-3.6 2-8 2-8-1.3-8-2 3.6-2 8-2z",
};
export function icon(name: keyof typeof P | string, size = 22): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", P[name] ?? "");
  s.append(p);
  return s;
}
