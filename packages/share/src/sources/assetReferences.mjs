// @ts-check
import { parse as parseScript } from "acorn";
import { overrides, variableReferences } from "./variableAssets.mjs";
import { simple } from "acorn-walk";
import { parse as parseCss, walk as walkCss } from "css-tree";
import { rewriteSrcsetUrls } from "@hyperframes/parsers/asset-paths";
import {
  scanHtmlOpeningTags,
  decodeAuthoredAttribute,
} from "@hyperframes/parsers/html-attribute-spans";

/** @typedef {{ id: string, values: Record<string,unknown> }} Host
 * @typedef {(value: string, base: URL, host?: Host) => void} Reference */

/** @param {string} source @param {URL} base @param {Reference} add @param {"stylesheet"|"declarationList"|"value"} context */
function cssReferences(source, base, add, context) {
  const tree = parseCss(source, { context, parseCustomProperty: true });
  walkCss(tree, function (node) {
    if (node.type === "Url") add(node.value, base);
    if (
      node.type === "String" &&
      (this.atrule?.name.toLowerCase() === "import" ||
        /^(?:-webkit-)?image-set$/i.test(this.function?.name ?? ""))
    )
      add(node.value, base);
  });
}

/** @param {import("acorn").Node | null | undefined} node */
function literal(node) {
  if (node && "value" in node && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") {
    const template = /** @type {import("acorn").TemplateLiteral} */ (node);
    if (!template.expressions.length) return template.quasis[0]?.value.cooked;
  }
  return null;
}

/** @param {import("acorn").Node} node */
function nameOf(node) {
  if ("name" in node) return node.name;
  if (node.type === "MemberExpression") {
    const { property, computed } = /** @type {import("acorn").MemberExpression} */ (node);
    return !computed && "name" in property ? property.name : literal(property);
  }
  return null;
}

/** @param {import("acorn").Node | undefined} node */
function isImportMetaUrl(node) {
  if (node?.type !== "MemberExpression") return false;
  const member = /** @type {import("acorn").MemberExpression} */ (node);
  return (
    nameOf(member) === "url" &&
    member.object.type === "MetaProperty" &&
    member.object.meta.name === "import"
  );
}

/** @param {string} source @param {URL} moduleUrl @param {URL} documentUrl @param {Reference} add */
function scriptReferences(source, moduleUrl, documentUrl, add) {
  let tree;
  try {
    tree = parseScript(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    tree = parseScript(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
  }
  /** @param {import("acorn").Node | null | undefined} node @param {URL} base */
  const ref = (node, base) => {
    const url = literal(node);
    if (url) add(url, base);
  };
  /** @param {import("acorn").Node|null|undefined} node */
  const moduleRef = (node) => {
    const specifier = literal(node);
    if (specifier && /^(?:\.\.?\/|\/)/.test(specifier)) add(specifier, moduleUrl);
  };
  simple(tree, {
    ImportDeclaration: (n) => moduleRef(n.source),
    ExportNamedDeclaration: (n) => moduleRef(n.source),
    ExportAllDeclaration: (n) => moduleRef(n.source),
    ImportExpression: (n) => moduleRef(n.source),
    AssignmentExpression(n) {
      if (n.left.type === "MemberExpression" && ["src", "poster"].includes(String(nameOf(n.left))))
        ref(n.right, documentUrl);
    },
    CallExpression(n) {
      const name = nameOf(n.callee);
      if (name === "fetch") ref(n.arguments[0], documentUrl);
      if (name === "setAttribute" && ["src", "poster"].includes(String(literal(n.arguments[0]))))
        ref(n.arguments[1], documentUrl);
    },
    NewExpression(n) {
      if (nameOf(n.callee) === "Audio") ref(n.arguments[0], documentUrl);
      if (nameOf(n.callee) === "FontFace") {
        const source = literal(n.arguments[1]);
        if (source) cssReferences(source, documentUrl, add, "value");
      }
      const base = n.arguments[1];
      if (nameOf(n.callee) === "URL" && isImportMetaUrl(base)) ref(n.arguments[0], moduleUrl);
    },
  });
}

const SOURCE_TAGS = new Set([
  "img",
  "video",
  "audio",
  "source",
  "track",
  "script",
  "iframe",
  "embed",
  "input",
]);
const SVG_HREF_TAGS = new Set(["use", "image", "feimage"]);
const RESOURCE_RELS = /(?:^|\s)(?:stylesheet|icon|preload|modulepreload)(?:\s|$)/i;
const JS_TYPE = /^(?:module|(?:(?:text|application)\/(?:java|ecma)script)(?:\s*;.*)?)?$/i;

/** @param {import("@hyperframes/parsers/html-attribute-spans").HtmlOpeningTagSpan} tag */
function attributes(tag) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const attr of tag.attributes) {
    if (attr.kind === "value" && !values.has(attr.name))
      values.set(attr.name, decodeAuthoredAttribute(attr.value));
  }
  return values;
}

/** @param {string} tag @param {Map<string,string>} attrs */
function resourceAttributes(tag, attrs) {
  const names = [];
  if (SOURCE_TAGS.has(tag)) names.push("src");
  if (tag === "video") names.push("poster");
  if (tag === "object") names.push("data");
  if (SVG_HREF_TAGS.has(tag)) names.push(attrs.has("href") ? "href" : "xlink:href");
  if (tag === "link" && RESOURCE_RELS.test(attrs.get("rel") ?? "")) names.push("href");
  return names;
}

/** @param {Map<string,string>} attrs @param {URL} base @param {Reference} add */
function compositionReference(attrs, base, add) {
  const child = attrs.get("data-composition-src");
  if (child)
    add(child, base, {
      id: (
        attrs.get("data-hf-original-composition-id") ||
        attrs.get("data-composition-id") ||
        ""
      ).trim(),
      values: overrides(attrs.get("data-variable-values") ?? null),
    });
}

/** @param {string} tag @param {Map<string,string>} attrs @param {URL} base @param {Reference} add */
function attributeReferences(tag, attrs, base, add) {
  compositionReference(attrs, base, add);
  for (const name of resourceAttributes(tag, attrs)) {
    const value = attrs.get(name);
    if (value) add(value, base);
  }
  const srcset = tag === "link" ? attrs.get("imagesrcset") : attrs.get("srcset");
  if (srcset && ["img", "source", "link"].includes(tag))
    rewriteSrcsetUrls(srcset, (value) => {
      add(value, base);
      return value;
    });
  const style = attrs.get("style");
  if (style) cssReferences(style, base, add, "declarationList");
}

/** @param {string} tag @param {Map<string,string>} attrs @param {string} body @param {URL} base @param {Reference} add */
function inlineReferences(tag, attrs, body, base, add) {
  if (tag === "style") cssReferences(body, base, add, "stylesheet");
  if (tag === "script" && !attrs.has("src") && JS_TYPE.test(attrs.get("type") ?? ""))
    scriptReferences(body, base, base, add);
}

/** @param {string} source @param {URL} url @param {Reference} add */
function htmlReferences(source, url, add) {
  const tags = scanHtmlOpeningTags(source);
  const baseTag = tags.find((tag) => tag.name === "base" && attributes(tag).has("href"));
  const base = baseTag ? new URL(attributes(baseTag).get("href") ?? "", url) : url;
  const mediaSlots = variableReferences(source, (value) => add(value, base));
  for (const tag of tags) {
    const attrs = attributes(tag);
    attributeReferences(tag.name, attrs, base, add);
    if (tag.rawTextEnd !== null)
      inlineReferences(tag.name, attrs, source.slice(tag.end, tag.rawTextEnd), base, add);
  }
  return { base, mediaSlots };
}

/** @param {string} path @param {string} source @param {URL} url @param {URL} documentUrl @param {Reference} add */
export function collectAssetReferences(path, source, url, documentUrl, add) {
  if (/\.css$/i.test(path)) cssReferences(source, url, add, "stylesheet");
  else if (/\.[cm]?js$/i.test(path)) scriptReferences(source, url, documentUrl, add);
  else return htmlReferences(source, url, add);
}
