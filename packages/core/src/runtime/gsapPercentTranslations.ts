interface TransformCache {
  x?: string;
  y?: string;
  xPercent?: number;
  yPercent?: number;
  uncache?: number;
}

type PluginCall = (this: unknown, target: HTMLElement, ...args: unknown[]) => unknown;
interface CssPlugin {
  get: PluginCall;
  getSetter: PluginCall;
  aliases: Record<string, string> & { transform: string };
  prototype: { init: PluginCall };
}

export interface GsapTransformInternals {
  plugins?: { css?: CssPlugin };
  core?: { getCache: (target: HTMLElement) => unknown };
}

const installed = new WeakSet<CssPlugin>();

/** The CSS centering translate plus any percentages GSAP already rendered inline. */
function authoredPercents(target: HTMLElement, style: CSSStyleDeclaration) {
  const [cssX, cssY] = style.translate.split(/\s+/);
  const rendered = /^translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)/.exec(target.style.transform);
  const axis = (css: string | undefined, inline: string | undefined): number | null => {
    const centered = css === "-50%" ? -50 : null;
    return inline === undefined ? centered : Number(inline) + (centered ?? 0);
  };
  return { x: axis(cssX, rendered?.[1]), y: axis(cssY, rendered?.[2]) };
}

/** The box CSS percentages in `translate` resolve against, per `transform-box`. */
function referenceSize(style: CSSStyleDeclaration, dimension: "width" | "height"): number {
  const sides = dimension === "width" ? ["left", "right"] : ["top", "bottom"];
  let edges = 0;
  for (const side of sides)
    edges +=
      Number.parseFloat(style.getPropertyValue(`padding-${side}`)) +
      Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
  const content =
    Number.parseFloat(style[dimension]) - (style.boxSizing === "border-box" ? edges : 0);
  return style.transformBox === "content-box" || style.transformBox === "fill-box"
    ? content
    : content + edges;
}

/** Move GSAP's inferred percentage back to the authored one, keeping the rendered position. */
function restoreAxis(
  cache: TransformCache,
  position: "x" | "y",
  authored: number,
  size: number,
  offsetSize: number,
): void {
  const percent = position === "x" ? "xPercent" : "yPercent";
  const inferred = cache[percent];
  if (inferred === authored) return;
  const pixels = Number.parseFloat(cache[position] ?? "");
  if (!Number.isFinite(pixels) || !Number.isFinite(size) || !Number.isFinite(inferred))
    throw new Error("GSAP CSS transform cache no longer matches the percentage adapter");
  cache[position] = `${pixels + (offsetSize * inferred! - size * authored) / 100}px`;
  cache[percent] = authored;
}

/** Preserve CSS centering before GSAP infers percentages from a zoom-snapped pixel matrix. */
export function installGsapPercentTranslations(gsap: GsapTransformInternals): void {
  const css = gsap.plugins?.css;
  const core = gsap.core;
  if (!css || !core || installed.has(css)) return;
  const get = css.get;
  const transformProperties = new Set(css.aliases.transform.split(","));
  for (const [alias, properties] of Object.entries(css.aliases))
    if (properties.split(",").some((property) => transformProperties.has(property)))
      transformProperties.add(alias);
  const preserve = (target: HTMLElement): void => {
    if (target.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
    const cache = core.getCache(target) as TransformCache;
    if (cache.x !== undefined && !cache.uncache) return;
    const view = target.ownerDocument.defaultView;
    if (!view) return;
    const style = view.getComputedStyle(target);
    const { x, y } = authoredPercents(target, style);
    if (x === null && y === null) return;
    const width = referenceSize(style, "width");
    const height = referenceSize(style, "height");
    get.call(css, target, "x");
    if (x !== null) restoreAxis(cache, "x", x, width, target.offsetWidth);
    if (y !== null) restoreAxis(cache, "y", y, height, target.offsetHeight);
  };
  const wrap = (call: PluginCall, properties: (args: unknown[]) => string[]): PluginCall =>
    function (target, ...args) {
      if (properties(args).some((property) => transformProperties.has(property))) preserve(target);
      return call.call(this, target, ...args);
    };
  css.get = wrap(get, ([property]) => [String(property)]);
  css.getSetter = wrap(css.getSetter, ([property]) => [String(property)]);
  css.prototype.init = wrap(css.prototype.init, ([vars]) => Object.keys(vars as object));
  installed.add(css);
}
