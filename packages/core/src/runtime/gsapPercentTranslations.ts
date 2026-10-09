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

// CSSPlugin parses transforms for these too, but they are not in `aliases.transform`.
const TRANSFORM_SETTINGS = [
  "transform",
  "transformOrigin",
  "svgOrigin",
  "force3D",
  "smoothOrigin",
  "transformPerspective",
];

/** Percent part of one computed translate length: "-50%" is -50, "12px" is 0, calc() is NaN. */
function percentOf(length: string): number {
  if (length.endsWith("%")) return Number(length.slice(0, -1));
  return length.endsWith("px") ? 0 : Number.NaN;
}

/** Authored percentages of the CSS `translate` plus the leading translates of `transform`. */
function authoredPercents(target: HTMLElement, style: CSSStyleDeclaration): [number, number] {
  let x = 0;
  let y = 0;
  if (style.translate !== "none") {
    const [lengthX = "0px", lengthY = "0px"] = style.translate.split(" ");
    x += percentOf(lengthX);
    y += percentOf(lengthY);
  }
  // Only Typed OM keeps a stylesheet transform's percentages; without it GSAP parses as before.
  const transform = target.computedStyleMap?.().get("transform");
  if (transform && transform instanceof CSSTransformValue)
    for (const component of transform) {
      if (!(component instanceof CSSTranslate)) break;
      x += percentOf(String(component.x));
      y += percentOf(String(component.y));
    }
  return [x, y];
}

/** The border box, which Chrome resolves translate percentages against in the matrix. */
function borderBoxSize(style: CSSStyleDeclaration, dimension: "width" | "height"): number {
  // Without a box (display:none) the computed size can stay "auto" or "40%": no usable size.
  if (!style[dimension].endsWith("px")) return Number.NaN;
  const size = Number.parseFloat(style[dimension]);
  if (style.boxSizing === "border-box") return size;
  const sides = dimension === "width" ? ["left", "right"] : ["top", "bottom"];
  let edges = 0;
  for (const side of sides)
    edges +=
      Number.parseFloat(style.getPropertyValue(`padding-${side}`)) +
      Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
  return size + edges;
}

/** Give back the -50% GSAP would infer without zoom snapping, keeping the rendered position. */
function restoreCentering(
  cache: TransformCache,
  position: "x" | "y",
  authored: number,
  size: number,
  offsetSize: number,
): void {
  const percent = position === "x" ? "xPercent" : "yPercent";
  const inferred = cache[percent];
  // GSAP folds every other percentage into pixels, so only centering is restored.
  if (authored !== -50 || inferred === -50 || !Number.isFinite(size)) return;
  const pixels = Number.parseFloat(cache[position] ?? "");
  if (!Number.isFinite(pixels) || !Number.isFinite(inferred))
    throw new Error("GSAP CSS transform cache no longer matches the percentage adapter");
  cache[position] = `${pixels + (offsetSize * inferred! + size * 50) / 100}px`;
  cache[percent] = -50;
}

/** Preserve CSS centering before GSAP infers percentages from a zoom-snapped pixel matrix. */
export function installGsapPercentTranslations(gsap: GsapTransformInternals): void {
  const css = gsap.plugins?.css;
  const core = gsap.core;
  if (!css || !core || installed.has(css)) return;
  const get = css.get;
  const transformProperties = new Set([...css.aliases.transform.split(","), ...TRANSFORM_SETTINGS]);
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
    const [x, y] = authoredPercents(target, style);
    if (x !== -50 && y !== -50) return;
    get.call(css, target, "x");
    restoreCentering(cache, "x", x, borderBoxSize(style, "width"), target.offsetWidth);
    restoreCentering(cache, "y", y, borderBoxSize(style, "height"), target.offsetHeight);
  };
  const wrap = (call: PluginCall, properties: (args: unknown[]) => string[]): PluginCall =>
    function (target, ...args) {
      if (properties(args).some((property) => transformProperties.has(property))) preserve(target);
      return call.call(this, target, ...args);
    };
  // Only where GSAP itself parses: `get` skips "transform", `getSetter` skips "transformOrigin".
  css.get = wrap(get, ([property]) => (property === "transform" ? [] : [String(property)]));
  css.getSetter = wrap(css.getSetter, ([property]) =>
    property === "transformOrigin" ? [] : [String(property)],
  );
  css.prototype.init = wrap(css.prototype.init, ([vars]) => Object.keys(vars as object));
  installed.add(css);
}
