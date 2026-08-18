/**
 * Make a component's catalog preview answer its variables panel.
 *
 * A component ships two HTML files. The snippet is what the page hands you to
 * paste: it carries `data-composition-variables`, a script that turns a chosen
 * value into a CSS custom property, and CSS written against those properties.
 * `demo.html` stages that component against a background and registers the
 * GSAP timeline that makes the preview move.
 *
 * The catalog preview is built from the demo, and the demo is a hand-authored
 * copy rather than a reference. The copies drifted: of the 168 components that
 * declare variables, 166 demos have no declaration and no reader, so the
 * preview renders constants and the panel cannot move it whatever is picked.
 *
 * There is no single repair, because components come in two shapes. See
 * `snippetOwnsItsMotion` for the split and how it was established. This module
 * handles the shape where the demo owns the motion: it keeps the demo's markup
 * and timeline and layers on the three things the copy lost.
 *
 *   1. the declaration, copied verbatim from the snippet's root
 *   2. the snippet's `<style>`, appended so its var()-driven rules win on
 *      document order over the demo's hardcoded copies
 *   3. the snippet's `<script>`, which sets the properties that CSS reads
 *
 * Nothing in the demo's DOM is moved or rewritten, which is what keeps the
 * animation intact.
 */

/**
 * Does the snippet bring its own motion, or only a recipe for it?
 *
 * Components come in two shapes and the preview has to be built differently
 * for each. 123 of the 168 that declare variables register their own paused
 * GSAP timeline: those are whole pieces, and the preview is best built from the
 * snippet, which then carries markup, variables and motion together. The other
 * 45 are markup plus a commented recipe, and it is the demo that animates them,
 * so those keep the demo and have the variable machinery layered on.
 *
 * Getting this backwards is not subtle. Build a self-contained component from
 * its demo with the snippet layered on and two timelines register under the
 * same id; build a recipe-only one from its snippet and the preview holds
 * still. Both were observed before this split existed.
 *
 * Comments are stripped first, because the recipe is written as one.
 */
export function snippetOwnsItsMotion(snippetHtml: string): boolean {
  const live = snippetHtml.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return live.includes("__timelines") && live.includes("gsap.timeline");
}

/**
 * Components that register a timeline but still render a still frame when the
 * preview is built from their snippet.
 *
 * Both were measured, not guessed: their previews moved before this change and
 * were static after, while every other self-contained component kept moving.
 * The cause is in the pieces themselves rather than in the rule, so they keep
 * the preview they had. That leaves their panel inert, which is the state they
 * were already in, rather than trading an inert panel for a frozen preview.
 */
export const SNIPPET_PREVIEW_RENDERS_STILL = new Set(["ascii-render-pass", "star-rating-fill"]);

const DECLARATION = /data-composition-variables\s*=\s*'(\[[\s\S]*?\])'/;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/g;
const SCRIPT_BLOCK = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g;
/** The element the snippet hangs its declaration on, and that element's tag. */
const DECLARING_TAG = /<[a-zA-Z][\w-]*\b[^>]*data-composition-variables[\s\S]*?>/;
const COMPOSITION_ROOT_TAG = /<[a-zA-Z][\w-]*\b[^>]*\bdata-composition-id\b[^>]*>/;

/**
 * Where to hang the declaration in the demo.
 *
 * It does not have to be the same element the snippet used: the runtime merges
 * the declared defaults of every `[data-composition-variables]` in the
 * document, so any host in the demo resolves identically. What does matter is
 * that the snippet's script finds its targets, and it finds them by the
 * component's own class, which the demo's copy still carries.
 *
 * Preference order is the demo's copy of the component, then the composition
 * root, because putting it on the component keeps the payload shaped like the
 * markup a reader would paste.
 */
function findDeclarationHost(demoHtml: string, snippetHtml: string): string | null {
  const declaring = DECLARING_TAG.exec(snippetHtml);
  const classAttr = declaring ? /class\s*=\s*"([^"]*)"/.exec(declaring[0]) : null;
  const classes = (classAttr?.[1] ?? "").split(/\s+/).filter(Boolean);

  for (const cls of classes) {
    const onSameClass = new RegExp(
      `<[a-zA-Z][\\w-]*\\b[^>]*class\\s*=\\s*"[^"]*\\b${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^"]*"[^>]*>`,
    ).exec(demoHtml);
    if (onSameClass) return onSameClass[0];
  }
  return COMPOSITION_ROOT_TAG.exec(demoHtml)?.[0] ?? null;
}

export type LayerResult =
  | { applied: true; html: string }
  | { applied: false; html: string; reason: string };

/**
 * Layer a component snippet's variable machinery onto its demo.
 *
 * Returns the demo unchanged, with a reason, when the pair does not have the
 * shape this depends on. A component whose preview cannot be made to answer
 * its panel should keep the preview it has rather than get a broken one.
 */
export function layerVariablesOntoDemo(demoHtml: string, snippetHtml: string): LayerResult {
  const declaration = DECLARATION.exec(snippetHtml);
  if (!declaration) {
    return { applied: false, html: demoHtml, reason: "snippet declares no variables" };
  }

  if (DECLARATION.test(demoHtml)) {
    return { applied: false, html: demoHtml, reason: "demo already declares its variables" };
  }

  const rootTag = findDeclarationHost(demoHtml, snippetHtml);
  if (!rootTag) {
    return { applied: false, html: demoHtml, reason: "demo has nowhere to hang the declaration" };
  }

  if (!/<\/body>/i.test(demoHtml)) {
    return { applied: false, html: demoHtml, reason: "demo has no </body> to append to" };
  }

  const tag = rootTag;
  const selfClosing = tag.endsWith("/>");
  const withDeclaration =
    `${tag.slice(0, selfClosing ? -2 : -1)} data-composition-variables='${declaration[1]}'` +
    (selfClosing ? "/>" : ">");

  // Only the snippet's own inline blocks travel. A `src=` script is a shared
  // dependency the demo already loads, and copying it would re-run a library.
  const styles = snippetHtml.match(STYLE_BLOCK) ?? [];
  const scripts = snippetHtml.match(SCRIPT_BLOCK) ?? [];
  if (scripts.length === 0) {
    return { applied: false, html: demoHtml, reason: "snippet has no reader script" };
  }

  // Order matters twice, in opposite directions.
  //
  // The styles go last, so the snippet's var()-driven rules win over the
  // demo's hardcoded copies on document order.
  //
  // The script goes FIRST, ahead of the demo's own. Many component scripts
  // rebuild their subtree from the resolved values, and the demo's timeline
  // captures element references when it is built. Running the snippet's script
  // afterwards swapped those elements out from under a live timeline, which
  // animated detached nodes and left the preview frozen: nine previews that
  // used to move went static that way before this ordering was fixed.
  const firstDemoScript = /<script\b(?![^>]*\bsrc=)[^>]*>/i.exec(demoHtml);
  const withScript = firstDemoScript
    ? demoHtml.replace(firstDemoScript[0], `${scripts.join("\n")}\n${firstDemoScript[0]}`)
    : demoHtml.replace(/<\/body>/i, `${scripts.join("\n")}\n</body>`);

  const html = withScript
    .replace(tag, withDeclaration)
    .replace(/<\/body>/i, `${styles.join("\n")}\n</body>`);

  return { applied: true, html };
}
