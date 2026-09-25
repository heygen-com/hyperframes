import { WEB_CAPTURE_BUDGETS, utf8ByteLength } from "@hyperframes/core/web-capture";
import type { EditableDomDraft, SelectionRect } from "../protocol";
import type { CapturedModelDraft } from "./model";

const OMITTED_TAGS = new Set([
  "SCRIPT",
  "NOSCRIPT",
  "TEMPLATE",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "BASE",
]);

const OPAQUE_TAGS = new Set(["CANVAS", "VIDEO", "IMG", "SVG"]);
const SAFE_ATTRIBUTES = new Set([
  "alt",
  "colspan",
  "dir",
  "disabled",
  "height",
  "lang",
  "max",
  "min",
  "placeholder",
  "role",
  "rowspan",
  "title",
  "type",
  "value",
  "viewBox",
  "width",
]);

const STYLE_PROPERTIES = [
  "align-content",
  "align-items",
  "align-self",
  "aspect-ratio",
  "backdrop-filter",
  "background-blend-mode",
  "background-clip",
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-collapse",
  "border-radius",
  "border-spacing",
  "box-shadow",
  "box-sizing",
  "clip-path",
  "color",
  "columns",
  "contain",
  "display",
  "filter",
  "flex",
  "flex-flow",
  "float",
  "font",
  "font-feature-settings",
  "gap",
  "grid-area",
  "grid-auto-columns",
  "grid-auto-flow",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  "grid-template-areas",
  "grid-template-columns",
  "grid-template-rows",
  "height",
  "inset",
  "isolation",
  "justify-content",
  "justify-items",
  "justify-self",
  "letter-spacing",
  "line-height",
  "list-style",
  "margin",
  "mask",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "mix-blend-mode",
  "object-fit",
  "object-position",
  "opacity",
  "order",
  "outline",
  "overflow",
  "overflow-wrap",
  "padding",
  "perspective",
  "perspective-origin",
  "position",
  "table-layout",
  "text-align",
  "text-decoration",
  "text-indent",
  "text-overflow",
  "text-shadow",
  "text-transform",
  "transform",
  "transform-origin",
  "transform-style",
  "vertical-align",
  "visibility",
  "white-space",
  "width",
  "word-break",
  "word-spacing",
  "writing-mode",
  "z-index",
] as const;

const PSEUDO_STYLE_PROPERTIES = [
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "color",
  "display",
  "font",
  "height",
  "inset",
  "line-height",
  "opacity",
  "position",
  "text-shadow",
  "transform",
  "transform-origin",
  "width",
  "z-index",
] as const;

const DEFAULT_STYLE_VALUES: Readonly<Record<string, readonly string[]>> = {
  "backdrop-filter": ["none"],
  "background-blend-mode": ["normal"],
  "background-clip": ["border-box"],
  "background-image": ["none"],
  "background-position": ["0% 0%"],
  "background-repeat": ["repeat"],
  "background-size": ["auto"],
  "border-collapse": ["separate"],
  "border-spacing": ["0px 0px"],
  "box-shadow": ["none"],
  "clip-path": ["none"],
  columns: ["auto"],
  contain: ["none"],
  filter: ["none"],
  flex: ["0 1 auto"],
  "flex-flow": ["row nowrap"],
  float: ["none"],
  "font-feature-settings": ["normal"],
  "grid-area": ["auto"],
  "grid-auto-columns": ["auto"],
  "grid-auto-flow": ["row"],
  "grid-auto-rows": ["auto"],
  "grid-column": ["auto"],
  "grid-row": ["auto"],
  "grid-template-areas": ["none"],
  "grid-template-columns": ["none"],
  "grid-template-rows": ["none"],
  isolation: ["auto"],
  "list-style": ["outside none none"],
  "mix-blend-mode": ["normal"],
  opacity: ["1"],
  order: ["0"],
  overflow: ["visible"],
  perspective: ["none"],
  position: ["static"],
  "table-layout": ["auto"],
  "text-shadow": ["none"],
  transform: ["none"],
  "transform-style": ["flat"],
  visibility: ["visible"],
  "word-spacing": ["0px"],
  "writing-mode": ["horizontal-tb"],
  "z-index": ["auto"],
};

function isDefaultStyle(property: string, value: string, style: CSSStyleDeclaration): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    [
      "align-content",
      "align-items",
      "align-self",
      "justify-content",
      "justify-items",
      "justify-self",
    ].includes(property)
  ) {
    return normalized === "normal" || normalized === "auto";
  }
  if (property === "background-color") {
    return normalized === "rgba(0, 0, 0, 0)" || normalized === "transparent";
  }
  if (property === "border") return /^0px none /.test(normalized);
  if (property === "border-radius" || property === "gap") return normalized === "0px";
  if (property === "margin" || property === "padding") return /^0px(?: 0px){0,3}$/.test(normalized);
  if (property === "outline") return normalized.includes(" none 0px");
  if (property === "transform-origin") {
    return style.getPropertyValue("transform") === "none";
  }
  return DEFAULT_STYLE_VALUES[property]?.includes(normalized) ?? false;
}

export type EditableDomCaptureResult =
  | { ok: true; capture: EditableDomDraft }
  | {
      ok: false;
      reason: "node-budget" | "html-budget" | "not-visible";
      actual?: number;
    };

interface BuildContext {
  document: Document;
  nodeCount: number;
  opaqueIslands: EditableDomDraft["opaqueIslands"];
  modelIslands: EditableDomDraft["modelIslands"];
  modelCandidate: CapturedModelDraft | null;
  refusal: "node-budget" | null;
}

function visibleRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
}

function selectionRect(rect: DOMRect): SelectionRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

function copySafeAttributes(source: Element, target: Element): void {
  for (const attribute of source.attributes) {
    const name = attribute.name;
    if (name.startsWith("aria-")) {
      target.setAttribute(name, attribute.value);
      continue;
    }
    if (SAFE_ATTRIBUTES.has(name)) target.setAttribute(name, attribute.value);
  }
}

function styleText(
  style: CSSStyleDeclaration,
  root: boolean,
  properties: readonly string[] = STYLE_PROPERTIES,
): string {
  const declarations: string[] = [];
  for (const property of properties) {
    let value = style.getPropertyValue(property);
    if (!value || value.includes("url(")) continue;
    if (property === "position" && root) value = "relative";
    if (root && ["left", "right", "top", "bottom", "inset", "margin"].includes(property)) {
      value = property === "margin" ? "0px" : "auto";
    }
    if (isDefaultStyle(property, value, style)) continue;
    declarations.push(`${property}:${value}`);
  }
  declarations.push("animation:none", "transition:none");
  return declarations.join(";");
}

function hasDetachedGridDependency(style: CSSStyleDeclaration): boolean {
  return [style.gridTemplateColumns, style.gridTemplateRows].some((value) =>
    value.toLowerCase().includes("subgrid"),
  );
}

function isTransparentColor(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return normalized === "transparent" || normalized === "rgba(0,0,0,0)";
}

function effectiveBackgroundColor(element: Element): string | null {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && !isTransparentColor(color)) return color;
  }
  return null;
}

function fixedRootGeometry(rect: DOMRect, backgroundColor: string | null): string {
  return [
    "position:relative",
    "inset:auto",
    "margin:0",
    "box-sizing:border-box",
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    backgroundColor ? `background-color:${backgroundColor}` : "",
  ].join(";");
}

function detachedGridGeometry(rect: DOMRect): string {
  return [
    "display:block",
    "grid-template-areas:none",
    "grid-template-columns:none",
    "grid-template-rows:none",
    "box-sizing:border-box",
    `width:${rect.width}px`,
    `height:${rect.height}px`,
  ].join(";");
}

function anchoredGeometry(source: Element, parentRect: DOMRect): string {
  const rect = source.getBoundingClientRect();
  return [
    "position:absolute",
    "inset:auto",
    `left:${rect.left - parentRect.left}px`,
    `top:${rect.top - parentRect.top}px`,
    "right:auto",
    "bottom:auto",
    "margin:0",
    "box-sizing:border-box",
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    "grid-area:auto",
    "grid-column:auto",
    "grid-row:auto",
    "transform:none",
  ].join(";");
}

function pseudoElement(
  source: Element,
  pseudo: "::before" | "::after",
  doc: Document,
): Element | null {
  const style = getComputedStyle(source, pseudo);
  const content = style.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") return null;
  const node = doc.createElement("span");
  node.setAttribute("data-hf-captured-pseudo", pseudo.slice(2));
  node.setAttribute("style", styleText(style, false, PSEUDO_STYLE_PROPERTIES));
  const match = /^(["'])(.*)\1$/.exec(content);
  if (match)
    node.textContent = (match[2] ?? "").replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
  return node;
}

function shouldRasterize(element: Element): boolean {
  if (OPAQUE_TAGS.has(element.tagName)) return true;
  if (element.tagName === "IFRAME") {
    try {
      return !(element as HTMLIFrameElement).contentDocument?.body;
    } catch {
      return true;
    }
  }
  return element.tagName.includes("-") && !element.shadowRoot && element.childNodes.length === 0;
}

function buildOpaqueIsland(source: Element, ctx: BuildContext): Element | null {
  const rect = visibleRect(source);
  if (!rect) return null;
  const id = `opaque-${ctx.opaqueIslands.length + 1}`;
  ctx.opaqueIslands.push({ id, rect: selectionRect(rect) });
  const image = ctx.document.createElement("img");
  image.setAttribute("data-hf-resource-id", id);
  image.setAttribute("data-hf-captured-tag", source.tagName.toLowerCase());
  image.setAttribute("alt", source.getAttribute("alt") ?? "");
  image.setAttribute("style", `${styleText(getComputedStyle(source), false)};object-fit:fill`);
  return image;
}

function buildModelIsland(source: Element, ctx: BuildContext): Element | null {
  const candidate = ctx.modelCandidate;
  if (!candidate || source.tagName !== "CANVAS") return buildOpaqueIsland(source, ctx);
  const rect = visibleRect(source);
  if (!rect) return null;
  const id = `model-${ctx.modelIslands.length + 1}`;
  ctx.modelIslands.push({ id, ...candidate });
  ctx.modelCandidate = null;
  const holder = ctx.document.createElement("div");
  holder.setAttribute("data-hf-model-resource-id", id);
  holder.setAttribute("data-hf-captured-tag", "canvas");
  holder.setAttribute("style", `${styleText(getComputedStyle(source), false)};overflow:hidden`);
  return holder;
}

function buildFrame(source: HTMLIFrameElement, ctx: BuildContext, depth: number): Element | null {
  let frameDocument: Document | null = null;
  try {
    frameDocument = source.contentDocument;
  } catch {
    return buildOpaqueIsland(source, ctx);
  }
  if (!frameDocument?.body) return buildOpaqueIsland(source, ctx);
  const holder = ctx.document.createElement("div");
  holder.setAttribute("data-hf-captured-frame", "same-origin");
  holder.setAttribute("style", `${styleText(getComputedStyle(source), false)};overflow:hidden`);
  const body = buildElement(frameDocument.body, ctx, false, depth + 1);
  if (body) holder.append(body);
  return holder;
}

function buildElement(
  source: Element,
  ctx: BuildContext,
  root: boolean,
  depth: number,
  anchorTo?: DOMRect,
): Element | null {
  if (OMITTED_TAGS.has(source.tagName)) return null;
  ctx.nodeCount += 1;
  if (ctx.nodeCount > WEB_CAPTURE_BUDGETS.nodes || depth > WEB_CAPTURE_BUDGETS.depth) {
    ctx.refusal = "node-budget";
    return null;
  }
  if (source.tagName === "IFRAME") return buildFrame(source as HTMLIFrameElement, ctx, depth);
  if (shouldRasterize(source)) return buildModelIsland(source, ctx);

  const tag = source.tagName.toLowerCase();
  const node = ctx.document.createElement("div");
  copySafeAttributes(source, node);
  node.setAttribute("data-hf-captured-tag", tag);
  const sourceStyle = getComputedStyle(source);
  const sourceRect = source.getBoundingClientRect();
  const anchorsChildren = hasDetachedGridDependency(sourceStyle);
  const geometry = [
    root ? fixedRootGeometry(sourceRect, effectiveBackgroundColor(source)) : "",
    anchorsChildren ? detachedGridGeometry(sourceRect) : "",
    anchorTo ? anchoredGeometry(source, anchorTo) : "",
  ]
    .filter(Boolean)
    .join(";");
  node.setAttribute("style", `${styleText(sourceStyle, root)};${geometry}`);

  const before = pseudoElement(source, "::before", ctx.document);
  if (before) node.append(before);
  const children = source.shadowRoot ? source.shadowRoot.childNodes : source.childNodes;
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      node.append(ctx.document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child instanceof Element) {
      const built = buildElement(
        child,
        ctx,
        false,
        depth + 1,
        anchorsChildren ? sourceRect : undefined,
      );
      if (built) node.append(built);
    }
  }
  const after = pseudoElement(source, "::after", ctx.document);
  if (after) node.append(after);
  return node;
}

export function serializeEditableDom(
  element: Element,
  modelCandidate: CapturedModelDraft | null = null,
): EditableDomCaptureResult {
  const rootRect = visibleRect(element);
  if (!rootRect) return { ok: false, reason: "not-visible" };
  const captureDocument = document.implementation.createHTMLDocument("HyperFrames capture");
  const ctx: BuildContext = {
    document: captureDocument,
    nodeCount: 0,
    opaqueIslands: [],
    modelIslands: [],
    modelCandidate,
    refusal: null,
  };
  const clone = buildElement(element, ctx, true, 0);
  if (!clone || ctx.refusal || ctx.nodeCount > WEB_CAPTURE_BUDGETS.nodes) {
    return { ok: false, reason: "node-budget", actual: ctx.nodeCount };
  }
  const html = clone.outerHTML;
  const htmlBytes = utf8ByteLength(html);
  if (htmlBytes > WEB_CAPTURE_BUDGETS.htmlCssBytes) {
    return { ok: false, reason: "html-budget", actual: htmlBytes };
  }
  return {
    ok: true,
    capture: {
      html,
      css: "",
      width: Math.max(1, Math.round(rootRect.width * devicePixelRatio)),
      height: Math.max(1, Math.round(rootRect.height * devicePixelRatio)),
      opaqueIslands: ctx.opaqueIslands,
      modelIslands: ctx.modelIslands,
    },
  };
}
