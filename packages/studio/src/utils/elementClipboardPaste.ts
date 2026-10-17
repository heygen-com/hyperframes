import { clipboardNodeSelector, type ClipboardAttributeRewrite } from "./clipboardSelectors";
import {
  ELEMENT_CLIPBOARD_MAX_NODES,
  type ElementClipboard,
} from "@hyperframes/core/element-clipboard";
import {
  elementFontNames,
  renameElementFonts,
  embeddedResource,
  safeCssValue,
  sanitizeElementCss,
  sanitizeElementStyle,
} from "./elementClipboardCss";

const HTML_TAGS = new Set(
  "button a div section article header footer main aside nav span p h1 h2 h3 h4 h5 h6 b strong i em u s small sub sup br hr ul ol li dl dt dd blockquote pre code figure figcaption img table thead tbody tfoot tr td th colgroup col".split(
    " ",
  ),
);
const SVG_TAGS = new Set(
  "a svg g defs symbol use image rect circle ellipse line polyline polygon path text tspan textPath linearGradient radialGradient stop pattern mask clipPath marker filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence title desc".split(
    " ",
  ),
);
const ATTRS = new Set(
  "class role width height viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry fx fy points d offset transform gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform maskUnits maskContentUnits clipPathUnits filterUnits primitiveUnits fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color stop-color stop-opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing text-decoration clip-path mask filter marker-start marker-mid marker-end display visibility overflow vector-effect paint-order color-interpolation color-interpolation-filters startOffset textLength lengthAdjust in in2 result mode type dx dy stdDeviation edgeMode k1 k2 k3 k4 operator radius scale xChannelSelector yChannelSelector baseFrequency numOctaves seed stitchTiles tableValues slope intercept amplitude exponent order divisor bias targetX targetY kernelMatrix preserveAlpha kernelUnitLength surfaceScale diffuseConstant specularConstant specularExponent lighting-color flood-color flood-opacity azimuth elevation pointsAtX pointsAtY pointsAtZ limitingConeAngle colspan rowspan".split(
    " ",
  ),
);
const SVG_NS = "http://www.w3.org/2000/svg";

interface CopyContext {
  output: Document;
  ids: ReadonlyMap<string, string>;
  nodeIds: ReadonlyMap<Element, string>;
  fonts: ReadonlyMap<string, string>;
  warn: () => void;
  attributes: Array<ClipboardAttributeRewrite & { node: Element }>;
}

function resourceAttribute(node: Element, attr: Attr): boolean {
  return (
    (attr.name === "src" && node.localName === "img") ||
    (["href", "xlink:href"].includes(attr.name) &&
      ["use", "image", "feImage"].includes(node.localName))
  );
}

function writeAttribute(
  clean: Element,
  attr: Attr,
  value: string,
  context: CopyContext,
  name = attr.name,
): void {
  clean.setAttribute(name, value);
  const accepted = clean.getAttributeNode(name)!;
  context.attributes.push({
    node: clean,
    name: attr.name,
    afterName: accepted.name,
    before: attr.value,
    after: accepted.value,
  });
}

function writeSynthesizedAttribute(
  clean: Element,
  name: string,
  value: string,
  context: CopyContext,
): void {
  const before = clean.getAttribute(name);
  clean.setAttribute(name, value);
  if (!context.attributes.some((attr) => attr.node === clean && attr.afterName === name))
    context.attributes.push({ node: clean, name, afterName: name, before, after: value });
}

function copyResource(node: Element, clean: Element, attr: Attr, context: CopyContext): void {
  const fragment = context.ids.get(attr.value.slice(1));
  if (attr.value.startsWith("#") && fragment)
    writeAttribute(clean, attr, `#${fragment}`, context, "href");
  else if (embeddedResource(attr.value) && node.localName !== "use")
    writeAttribute(clean, attr, attr.value, context);
  else context.warn();
}

function copyKnownAttribute(clean: Element, attr: Attr, context: CopyContext): void {
  if (!ATTRS.has(attr.name)) {
    context.warn();
    return;
  }
  const value = safeCssValue(attr.value, context.ids);
  if (value === null) {
    context.warn();
    return;
  }
  writeAttribute(
    clean,
    attr,
    attr.name === "font-family" ? renameElementFonts(value, context.fonts) : value,
    context,
  );
}

function copyAttribute(node: Element, clean: Element, attr: Attr, context: CopyContext): void {
  if (attr.name === "id") return;
  if (attr.name === "data-hf-n" && /^\d{1,6}$/.test(attr.value))
    writeAttribute(clean, attr, attr.value, context);
  else if (attr.name === "style")
    writeAttribute(
      clean,
      attr,
      sanitizeElementStyle(attr.value, context.ids, context.warn, context.fonts),
      context,
    );
  else if (resourceAttribute(node, attr)) copyResource(node, clean, attr, context);
  else copyKnownAttribute(clean, attr, context);
}

function cleanElement(node: Element, context: CopyContext): Element | null {
  const svg = node.namespaceURI === SVG_NS;
  if (!(svg ? SVG_TAGS : HTML_TAGS).has(node.localName)) {
    context.warn();
    return null;
  }
  const clean = svg
    ? context.output.createElementNS(SVG_NS, node.localName)
    : context.output.createElement(node.localName);
  const id = context.nodeIds.get(node);
  if (id) clean.id = id;
  for (const attr of Array.from(node.attributes)) copyAttribute(node, clean, attr, context);
  if (node.localName === "button") writeSynthesizedAttribute(clean, "type", "button", context);
  return clean;
}

function copyNode(node: Node, parent: Element, context: CopyContext): void {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.append(context.output.createTextNode(node.textContent ?? ""));
    return;
  }
  if (!(node instanceof Element) || node.localName === "style") return;
  const clean = cleanElement(node, context);
  if (!clean) return;
  for (const child of Array.from(node.childNodes)) copyNode(child, clean, context);
  parent.append(clean);
}

/** Build a fresh inert allowlisted tree: no original nodes/attributes enter the composition. */
export function prepareElementClipboard(
  payload: ElementClipboard,
  scope: string,
  fontScope = scope,
): { html: string; warnings: string[] } {
  if (![scope, fontScope].every((value) => /^[a-z][a-z0-9-]*$/.test(value)))
    throw new TypeError("Invalid element scope");
  const template = document.createElement("template");
  template.innerHTML = payload.html;
  const elements = Array.from(template.content.querySelectorAll("*"));
  if (elements.length > ELEMENT_CLIPBOARD_MAX_NODES)
    throw new Error("Element contains too many nodes");
  const output = document.implementation.createHTMLDocument("");
  const wrapper = output.createElement("div");
  wrapper.id = scope;
  wrapper.style.cssText = `position: absolute; left: 0px; top: 0px; width: ${payload.width}px; height: ${payload.height}px; isolation: isolate; overflow: hidden;`;
  const warnings = new Set(payload.warnings);
  const warn = () => {
    warnings.add(
      "Unsupported content or unavailable resources were removed; appearance may differ.",
    );
  };
  const ids = new Map<string, string>();
  const nodeIds = new Map<Element, string>();
  elements.forEach((el, index) => {
    if (el.id) {
      const id = `${scope}-node-${index}`;
      nodeIds.set(el, id);
      if (!ids.has(el.id)) ids.set(el.id, id);
    }
  });
  const cssSource = [
    payload.css,
    ...elements.filter((el) => el.localName === "style").map((el) => el.textContent ?? ""),
  ].join("\n");
  const fonts = elementFontNames(cssSource, fontScope);
  const attributes: CopyContext["attributes"] = [];
  const context = { output, ids, nodeIds, fonts, warn, attributes };
  for (const child of Array.from(template.content.childNodes)) copyNode(child, wrapper, context);
  if (!wrapper.firstChild) throw new Error("Element has no supported content");
  const capturedRoot = wrapper.firstElementChild;
  if (capturedRoot && capturedRoot.namespaceURI !== SVG_NS) {
    const style = capturedRoot.getAttribute("style") ?? "";
    writeSynthesizedAttribute(
      capturedRoot,
      "style",
      `${style};position:relative!important;left:0px!important;top:0px!important;right:auto!important;bottom:auto!important;width:${payload.width}px!important;height:${payload.height}px!important;margin:0!important;`,
      context,
    );
  }
  const finalAttributes = attributes.map((reference) => ({
    ...reference,
    after: reference.node.getAttribute(reference.afterName!)!,
  }));
  const changedNodes = new Set(
    finalAttributes
      .filter(
        (reference) =>
          reference.name !== reference.afterName || reference.before !== reference.after,
      )
      .map((reference) => reference.node),
  );
  const targets = new Map(
    Array.from(changedNodes, (node) => [node, clipboardNodeSelector(node, new Map())]),
  );
  const writes = finalAttributes.flatMap(({ node, ...reference }) => {
    const target = targets.get(node);
    return target ? [{ ...reference, target, element: node }] : [];
  });
  const css = sanitizeElementCss(cssSource, scope, ids, warn, fonts, writes);
  if (css) {
    const style = output.createElement("style");
    style.setAttribute("data-hf-element-style", scope);
    style.textContent = css;
    wrapper.append(style);
  }
  return { html: wrapper.outerHTML, warnings: [...warnings] };
}
