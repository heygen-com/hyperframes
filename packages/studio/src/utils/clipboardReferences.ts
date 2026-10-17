import postcss from "postcss";
import {
  clipboardNodeSelector,
  rebindClipboardSelector,
  type ClipboardAttributeRewrite,
} from "./clipboardSelectors";
import {
  decodeAuthoredAttribute,
  scanHtmlOpeningTags,
  type HtmlAttributeSpan,
} from "@hyperframes/parsers/html-attribute-spans";

const URL_ATTRIBUTES = new Set([
  "style",
  "fill",
  "stroke",
  "clip-path",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
]);
const VALUE_TOKENS =
  /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\*[\s\S]*?\*\/|(?<![\w-])(url\(\s*)(["']?)#([^"')\s]+)\2(\s*\))/gi;

export function rebindClipboardUrls(value: string, renames: ReadonlyMap<string, string>): string {
  return value.replace(VALUE_TOKENS, (full, open, quote, id: string, close) => {
    const renamed = open && renames.get(id);
    return renamed ? `${open}${quote}#${renamed}${quote}${close}` : full;
  });
}

function stylesheet(
  css: string,
  renames: ReadonlyMap<string, string>,
  attributes: readonly ClipboardAttributeRewrite[],
): string {
  try {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      rule.selector = rebindClipboardSelector(rule.selector, renames, attributes);
    });
    root.walkDecls((decl) => {
      decl.value = rebindClipboardUrls(decl.value, renames);
    });
    return root.toString();
  } catch {
    return css;
  }
}

function attributeValue(name: string, value: string, renames: ReadonlyMap<string, string>): string {
  if ((name === "href" || name.endsWith(":href")) && value.startsWith("#")) {
    const renamed = renames.get(value.slice(1));
    return renamed ? `#${renamed}` : value;
  }
  return URL_ATTRIBUTES.has(name) ? rebindClipboardUrls(value, renames) : value;
}

interface SourceEdit {
  start: number;
  end: number;
  text: string;
}

function attributeEdit(
  attr: HtmlAttributeSpan,
  renames: ReadonlyMap<string, string>,
): SourceEdit | null {
  if (attr.kind !== "value") return null;
  const value = decodeAuthoredAttribute(attr.value);
  const rewritten = attributeValue(attr.name, value, renames);
  if (rewritten === value) return null;
  const quote = attr.quote || '"';
  const encoded = rewritten
    .replace(/&/g, "&amp;")
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? "&quot;" : "&#39;");
  return {
    start: attr.valueStart,
    end: attr.valueEnd,
    text: attr.quote ? encoded : `"${encoded}"`,
  };
}

export function clipboardAttributeRewrites(
  html: string,
  renames: ReadonlyMap<string, string>,
): ClipboardAttributeRewrite[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.querySelectorAll("*")).flatMap((node) => {
    const attributes = Array.from(node.attributes, (attr) => ({
      name: attr.name,
      before: attr.value,
      after:
        attr.name === "id"
          ? (renames.get(attr.value) ?? attr.value)
          : attributeValue(attr.name, attr.value, renames),
    }));
    if (!attributes.some((attr) => attr.before !== attr.after)) return [];
    const target = clipboardNodeSelector(node, renames);
    return attributes.map((attr) => ({ ...attr, target, element: node }));
  });
}

/** Rebind a clone's own references before insertion; destination styles and scripts stay untouched. */
export function rebindClipboardReferences(
  html: string,
  renames: ReadonlyMap<string, string>,
): string {
  if (!renames.size) return html;
  const edits: SourceEdit[] = [];
  const attributes = clipboardAttributeRewrites(html, renames);
  const tags = scanHtmlOpeningTags(html);
  for (const tag of tags)
    for (const attr of tag.attributes) {
      const edit = attributeEdit(attr, renames);
      if (edit) {
        edits.push(edit);
      }
    }
  for (const tag of tags) {
    if (tag.name !== "style" || tag.rawTextEnd === null) continue;
    const css = html.slice(tag.end, tag.rawTextEnd);
    const text = stylesheet(css, renames, attributes);
    if (text !== css) edits.push({ start: tag.end, end: tag.rawTextEnd, text });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}
