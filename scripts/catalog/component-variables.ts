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

const DECLARATION = /data-composition-variables\s*=\s*'(\[[\s\S]*?\])'/;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/g;
const SCRIPT_BLOCK = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g;
const DECLARING_TAG = /<[a-zA-Z][\w-]*\b[^>]*data-composition-variables[\s\S]*?>/;
const COMPOSITION_ROOT_TAG = /<[a-zA-Z][\w-]*\b[^>]*\bdata-composition-id\b[^>]*>/;
const INLINE_SCRIPT_OPEN = /<script\b(?![^>]*\bsrc=)[^>]*>/i;
// Existence checks use their own non-global copy on purpose: `.test()` on a
// /g regex advances its lastIndex, and these run in a loop over every
// component, so a shared one would start mid-string and miss on later items.
const HAS_INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/;
const BODY_CLOSE = /<\/body>/i;

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
 * its demo with the snippet layered on and it keeps rendering its defaults;
 * build a recipe-only one from its snippet and the preview holds still. Both
 * were observed before this split existed.
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

/** The classes the snippet hangs its declaration on, which its script targets. */
function declaringClasses(snippetHtml: string): string[] {
  const declaring = DECLARING_TAG.exec(snippetHtml);
  const classAttr = declaring ? /class\s*=\s*"([^"]*)"/.exec(declaring[0]) : null;
  return (classAttr?.[1] ?? "").split(/\s+/).filter(Boolean);
}

function openingTagWithClass(html: string, cls: string): string | null {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<[a-zA-Z][\\w-]*\\b[^>]*class\\s*=\\s*"[^"]*\\b${escaped}\\b[^"]*"[^>]*>`,
  );
  return pattern.exec(html)?.[0] ?? null;
}

/**
 * Where to hang the declaration in the demo.
 *
 * It does not have to be the same element the snippet used: the runtime merges
 * the declared defaults of every `[data-composition-variables]` in the
 * document, so any host in the demo resolves identically. What does matter is
 * that the snippet's script finds its targets, and it finds them by the
 * component's own class, which the demo's copy still carries.
 *
 * The component's own element is preferred over the composition root, because
 * that keeps the payload shaped like the markup a reader would paste.
 */
function findDeclarationHost(demoHtml: string, snippetHtml: string): string | null {
  const onOwnClass = declaringClasses(snippetHtml)
    .map((cls) => openingTagWithClass(demoHtml, cls))
    .find(Boolean);
  return onOwnClass ?? compositionRootTag(demoHtml);
}

function compositionRootTag(html: string): string | null {
  return COMPOSITION_ROOT_TAG.exec(html)?.[0] ?? null;
}

function withDeclarationAttribute(tag: string, declaration: string): string {
  const selfClosing = tag.endsWith("/>");
  const body = tag.slice(0, selfClosing ? -2 : -1);
  return `${body} data-composition-variables='${declaration}'${selfClosing ? "/>" : ">"}`;
}

export type LayerResult =
  | { applied: true; html: string }
  | { applied: false; html: string; reason: string };

/**
 * Everything that has to hold before a demo can be layered.
 *
 * A table rather than a chain of guards, so the refusals read as a list of
 * conditions with their messages beside them. A component whose preview cannot
 * be made to answer its panel keeps the preview it has rather than getting a
 * half-applied one.
 */
const REQUIREMENTS: { fails: (demo: string, snippet: string) => boolean; reason: string }[] = [
  { fails: (_d, s) => !DECLARATION.test(s), reason: "snippet declares no variables" },
  { fails: (d) => DECLARATION.test(d), reason: "demo already declares its variables" },
  { fails: (d) => !BODY_CLOSE.test(d), reason: "demo has no </body> to append to" },
  { fails: (_d, s) => !HAS_INLINE_SCRIPT.test(s), reason: "snippet has no reader script" },
  {
    fails: (d, s) => !findDeclarationHost(d, s),
    reason: "demo has nowhere to hang the declaration",
  },
];

/** Why this pair cannot be layered, or null when it can. */
function refuseReason(demoHtml: string, snippetHtml: string): string | null {
  return REQUIREMENTS.find((r) => r.fails(demoHtml, snippetHtml))?.reason ?? null;
}

/**
 * The snippet's own inline blocks, which are the only ones that travel.
 *
 * A `src=` script is a shared dependency the demo already loads, and copying it
 * would re-run a library.
 */
function inlineBlocks(snippetHtml: string, pattern: RegExp): string[] {
  return snippetHtml.match(pattern) ?? [];
}

/** Layer a component snippet's variable machinery onto its demo. */
export function layerVariablesOntoDemo(demoHtml: string, snippetHtml: string): LayerResult {
  const reason = refuseReason(demoHtml, snippetHtml);
  if (reason) return { applied: false, html: demoHtml, reason };

  const declaration = DECLARATION.exec(snippetHtml)?.[1] as string;
  const host = findDeclarationHost(demoHtml, snippetHtml) as string;

  const styles = inlineBlocks(snippetHtml, STYLE_BLOCK);
  const scripts = inlineBlocks(snippetHtml, SCRIPT_BLOCK);

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
  const html = withStylesAppended(withScriptsFirst(demoHtml, scripts), styles).replace(
    host,
    withDeclarationAttribute(host, declaration),
  );

  return { applied: true, html };
}

function withScriptsFirst(demoHtml: string, scripts: string[]): string {
  const firstDemoScript = INLINE_SCRIPT_OPEN.exec(demoHtml)?.[0];
  const block = scripts.join("\n");
  return firstDemoScript
    ? demoHtml.replace(firstDemoScript, `${block}\n${firstDemoScript}`)
    : demoHtml.replace(BODY_CLOSE, `${block}\n</body>`);
}

function withStylesAppended(html: string, styles: string[]): string {
  return html.replace(BODY_CLOSE, `${styles.join("\n")}\n</body>`);
}
