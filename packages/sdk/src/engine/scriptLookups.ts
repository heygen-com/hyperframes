// Whether an inline script could look the element up. A replayed delete of such a node is hidden,
// not removed: a missing node makes the script throw before the timeline registers.

const LITERAL_LOOKUP =
  /(getElementById|getElementsByClassName|getElementsByTagName|querySelector(?:All)?)\s*\(\s*(["'`])([\s\S]*?)\2\s*(\S?)/g;
// A lookup whose argument is a variable or an expression: it can name any node.
const DYNAMIC_LOOKUP =
  /(?:getElementById|getElementsByClassName|getElementsByTagName|querySelector(?:All)?)\s*\(\s*(?!["'`)\s])/;
const PLACEHOLDER = /\$\{[^}]*\}/;

function idPattern(text: string): RegExp {
  const parts = text.split(new RegExp(PLACEHOLDER.source, "g"));
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join("[\\w-]+")}$`);
}

function matchesSelector(el: Element, selector: string): boolean {
  if (PLACEHOLDER.test(selector)) return true;
  try {
    return el.matches(selector) || el.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

function lookupReaches(el: Element, method: string, argument: string): boolean {
  if (PLACEHOLDER.test(argument)) return true;
  const nodes = [el, ...Array.from(el.querySelectorAll("*"))];
  if (method === "getElementById") {
    const pattern = idPattern(argument);
    return nodes.some((node) => pattern.test(node.getAttribute("id") ?? "\0"));
  }
  if (method === "getElementsByClassName") {
    const wanted = argument.split(/\s+/).filter(Boolean);
    return nodes.some((node) => wanted.every((name) => node.classList.contains(name)));
  }
  if (method === "getElementsByTagName") {
    return argument === "*" || nodes.some((node) => node.localName === argument.toLowerCase());
  }
  return matchesSelector(el, argument);
}

export function scriptLooksUp(document: Document, el: Element): boolean {
  const scripts = Array.from(
    document.querySelectorAll("script:not([src])"),
    (s) => s.textContent ?? "",
  ).join("\n");
  if (DYNAMIC_LOOKUP.test(scripts)) return true;
  for (const [, method, , argument, next] of scripts.matchAll(LITERAL_LOOKUP)) {
    if (next !== ")" || lookupReaches(el, method ?? "", argument ?? "")) return true;
  }
  return false;
}
