import { parseHTML } from "linkedom";

function parseHTMLContent(html: string): Document {
  const trimmed = html.trimStart().toLowerCase();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    return parseHTML(html).document;
  }
  return parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`).document;
}

function getSingleMeaningfulChild(container: Element): Element | null {
  let child: Element | null = null;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3 && !(node.textContent || "").trim()) continue;
    if (node.nodeType === 8) continue;
    if (node.nodeType !== 1) return null;
    if (child) return null;
    child = node as Element;
  }
  return child;
}

/**
 * Sub-compositions commonly use a single top-level <template> wrapper. Parse
 * the HTML and unwrap only that exact shape, rather than pattern-matching the
 * raw string. This avoids both regex backtracking risk and accidental rewrites
 * of inputs that contain multiple sibling templates or other top-level content.
 */
export function unwrapTemplate(html: string): string {
  const lowered = html.toLowerCase();
  if (!lowered.includes("<template") || !lowered.includes("</template>")) {
    return html;
  }

  const { body } = parseHTMLContent(html);
  if (!body) return html;

  let container: Element = body;
  const bodyWrapper = getSingleMeaningfulChild(container);
  if (bodyWrapper?.tagName === "BODY") {
    container = bodyWrapper;
  }

  const template = getSingleMeaningfulChild(container);
  if (template?.tagName !== "TEMPLATE") {
    return html;
  }

  return template.innerHTML ?? html;
}
