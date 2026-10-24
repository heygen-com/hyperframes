import postcss, { type ChildNode, type AtRule } from "postcss";

const MARKER = /^hf-element-style:([a-z][a-z0-9-]*)$/;

function owner(rule: ChildNode): string | null {
  if (rule.type !== "atrule" || rule.name !== "media" || rule.params !== "all") return null;
  return rule.first?.type === "comment" ? (MARKER.exec(rule.first.text)?.[1] ?? null) : null;
}

export function ownedElementCss(css: string): Array<{ owner: string; css: string }> {
  try {
    return postcss.parse(css).nodes.flatMap((node) => {
      const id = owner(node);
      return id && node.type === "atrule"
        ? [
            {
              owner: id,
              css: node
                .nodes!.slice(1)
                .map((child) => child.toString())
                .join("\n"),
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}

export function unownedElementCss(css: string): string {
  try {
    const root = postcss.parse(css);
    for (const node of [...root.nodes]) if (owner(node)) node.remove();
    return root.toString();
  } catch {
    return css;
  }
}

export function elementCssBlock(id: string, css: string): string {
  const rule: AtRule = postcss.atRule({ name: "media", params: "all" });
  rule.append(postcss.comment({ text: `hf-element-style:${id}` }));
  rule.append(postcss.parse(css).nodes);
  return rule.toString();
}

export function appendElementCss(css: string, media: string, owned: string): string {
  const root = postcss.parse(css);
  let imports = false;
  let namespaces = false;
  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() === "import") imports = true;
    if (rule.name.toLowerCase() === "namespace") namespaces = true;
  });
  if (namespaces)
    throw new Error("Cannot paste styled content into a stylesheet with namespace bindings.");
  if (!media || media.toLowerCase() === "all") return css + "\n" + owned;
  if (imports || /[{}<>;]/.test(media))
    throw new Error(
      "Cannot paste styled content after a conditional stylesheet with imports or an unsupported media condition.",
    );
  return `@media ${media}{${css}}\n${owned}`;
}
