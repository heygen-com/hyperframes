/**
 * Studio's selection chrome painted inside a sealed frame during a drag, in the same turn as the layer's draft.
 * Studio owns the look (a copy sent as data); it lives in a closed shadow root that exists only during the drag.
 */
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

export type EditingDragChromeTag = "div" | "span" | "svg" | "path";
/** One node of Studio's chrome: `look` is its computed paint, set once; `children` in document order. */
export type EditingDragChromeNode = {
  tag: EditingDragChromeTag;
  look: Record<string, string>;
  attrs?: Record<string, string>;
  children?: EditingDragChromeNode[];
};
/** `place` is each node's inline style this step, in document order; `origin` and `scale` map overlay px
 * to the frame's (frame = (overlay - origin) / scale). `nodes` (re)mounts the copy; null clears it. */
export type EditingDragChrome = {
  origin: { x: number; y: number };
  scale: { x: number; y: number };
  place: Array<Record<string, string>>;
  nodes?: EditingDragChromeNode[];
} | null;

export const MAX_DRAG_CHROME_NODES = 64;
export const MAX_DRAG_CHROME_BYTES = 32_768;
const MAX_DEPTH = 6;
const MAX_PROPS = 48;
const TAGS: readonly string[] = ["div", "span", "svg", "path"];
const ATTRS: readonly string[] = [
  "d",
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "width",
  "height",
];
const PROP_NAME = /^-?[a-z][a-z0-9-]{0,63}$/;
// Paint only: nothing in the copy may make the frame fetch, nor a CSS escape that spells a fetch.
const FETCHES = /\\|url\(|image\(|image-set\(|src\(/i;

const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

function isMap(value: unknown, name: (key: string) => boolean): value is Record<string, string> {
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_PROPS &&
    entries.every(([key, v]) => name(key) && isText(v, 512) && !FETCHES.test(v))
  );
}

const isStyleMap = (value: unknown) => isMap(value, (key) => PROP_NAME.test(key));

function nodesWithin(nodes: unknown, depth: number, count: { n: number }): boolean {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return false;
  return nodes.every((node) => {
    if (!isPlainRecord(node) || ++count.n > MAX_DRAG_CHROME_NODES) return false;
    const { tag, look, attrs, children, ...rest } = node;
    return (
      !Object.keys(rest).length &&
      TAGS.includes(tag as string) &&
      isStyleMap(look) &&
      (attrs === undefined || isMap(attrs, (key) => ATTRS.includes(key))) &&
      (children === undefined || nodesWithin(children, depth + 1, count))
    );
  });
}

const isPair = (value: unknown, positive: boolean) =>
  isPlainRecord(value) &&
  Object.keys(value).sort().join() === "x,y" &&
  [value.x, value.y].every((n) => Number.isFinite(n) && (!positive || (n as number) > 0));

/** The chrome a draft request carries, or undefined when it is malformed or over the caps. */
export function parseDragChrome(value: unknown): EditingDragChrome | undefined {
  if (value === null) return null;
  if (!isPlainRecord(value)) return undefined;
  const { origin, scale, place, nodes, ...rest } = value;
  const count = { n: 0 };
  const valid = [
    !Object.keys(rest).length,
    isPair(origin, false),
    isPair(scale, true),
    Array.isArray(place) && place.length <= MAX_DRAG_CHROME_NODES && place.every(isStyleMap),
    nodes === undefined ||
      (nodesWithin(nodes, 1, count) && JSON.stringify(nodes).length <= MAX_DRAG_CHROME_BYTES),
  ];
  return valid.includes(false) ? undefined : (value as EditingDragChrome);
}

const SVG_NS = "http://www.w3.org/2000/svg";
const HOST_MARKS = [
  "data-hf-ignore",
  "data-hyperframes-ignore",
  "data-hyperframes-picker-ignore",
  "data-layout-ignore",
] as const;

let host: HTMLElement | null = null;
let plane: HTMLElement | null = null;
let placed: Array<HTMLElement | SVGElement> = [];
let looks: Array<Record<string, string>> = [];

export const isDragChromeHost = (element: Element): boolean => element === host;

function build(node: EditingDragChromeNode, into: Node): void {
  const element =
    node.tag === "svg" || node.tag === "path"
      ? document.createElementNS(SVG_NS, node.tag)
      : document.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs ?? {})) element.setAttribute(name, value);
  placed.push(element);
  looks.push(node.look);
  into.appendChild(element);
  for (const child of node.children ?? []) build(child, element);
}

function mount(nodes: readonly EditingDragChromeNode[]): void {
  clearDragChrome();
  host = document.createElement("div");
  for (const mark of HOST_MARKS) host.setAttribute(mark, "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:visible";
  const root = host.attachShadow({ mode: "closed" });
  plane = document.createElement("div");
  plane.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0";
  root.appendChild(plane);
  for (const node of nodes) build(node, plane);
  document.documentElement.appendChild(host);
}

function writeStyle(element: HTMLElement | SVGElement, props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) element.style.setProperty(name, value);
}

/** Mounts, places or clears the chrome; called in the same turn as the drafts it rides. */
export function drawDragChrome(chrome: EditingDragChrome): void {
  if (chrome === null) return clearDragChrome();
  if (chrome.nodes) mount(chrome.nodes);
  if (!plane || chrome.place.length !== placed.length) return;
  const { origin, scale } = chrome;
  plane.style.transform = `scale(${1 / scale.x}, ${1 / scale.y}) translate(${-origin.x}px, ${-origin.y}px)`;
  placed.forEach((element, i) => {
    element.removeAttribute("style");
    writeStyle(element, looks[i]!);
    writeStyle(element, chrome.place[i]!);
    element.style.setProperty("pointer-events", "none", "important");
  });
}

export function clearDragChrome(): void {
  host?.remove();
  host = plane = null;
  placed = [];
  looks = [];
}

/** Runs `read` with the chrome host out of the document, so nothing it reads carries it. */
export function withoutDragChrome<T>(read: () => T): T {
  const mounted = host;
  if (!mounted?.isConnected) return read();
  const html = document.documentElement;
  const next = mounted.nextSibling;
  mounted.remove();
  try {
    return read();
  } finally {
    if (host === mounted) html.insertBefore(mounted, next?.parentNode === html ? next : null);
  }
}
