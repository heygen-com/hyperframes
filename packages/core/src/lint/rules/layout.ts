import postcss from "postcss";
import type { LintContext, HyperframeLintFinding, OpenTag } from "../context";
import { readAttr, truncateSnippet } from "../utils";

// ── Shared parsing helpers ──────────────────────────────────────────────────

type DeclMap = Record<string, string>;

/**
 * Parse all `<style>` blocks via PostCSS and build a selector → declarations map.
 * Mirrors the pattern in `rules/core.ts` (`pointer_events_none`) and
 * `rules/textures.ts` (`collectTextureCss`). Last-write-wins for repeated decls
 * inside a single rule (matches browser cascade within a rule).
 */
function buildSelectorDeclMap(styles: LintContext["styles"]): Map<string, DeclMap> {
  const map = new Map<string, DeclMap>();
  for (const style of styles) {
    let root: postcss.Root;
    try {
      root = postcss.parse(style.content);
    } catch {
      continue;
    }
    root.walkRules((rule) => {
      const decls: DeclMap = {};
      for (const node of rule.nodes ?? []) {
        if (node.type !== "decl") continue;
        decls[node.prop.toLowerCase()] = node.value.trim();
      }
      for (const selector of rule.selectors ?? []) {
        const key = selector.trim();
        const existing = map.get(key) ?? {};
        map.set(key, { ...existing, ...decls });
      }
    });
  }
  return map;
}

/**
 * Parse `style="..."` into a DeclMap. Tolerant of trailing semicolons and
 * whitespace. Returns an empty map for missing or empty styles.
 */
function parseInlineStyle(style: string | null): DeclMap {
  const decls: DeclMap = {};
  if (!style) return decls;
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (!prop || !value) continue;
    decls[prop] = value;
  }
  return decls;
}

/**
 * Merge inline-style decls under each tag's id and class selectors into the
 * selector → DeclMap. Pattern derived from `gsap_css_transform_conflict`
 * (rules/gsap.ts:588-607). Inline styles do NOT clobber existing CSS rule
 * decls — we only fill in selectors that aren't already in the map.
 */
function mergeInlineStylesIntoMap(tags: OpenTag[], map: Map<string, DeclMap>): void {
  for (const tag of tags) {
    if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
    const inline = readAttr(tag.raw, "style");
    if (!inline) continue;
    const inlineDecls = parseInlineStyle(inline);
    if (Object.keys(inlineDecls).length === 0) continue;

    const id = readAttr(tag.raw, "id");
    const classes = (readAttr(tag.raw, "class") || "").split(/\s+/).filter(Boolean);
    const keys: string[] = [];
    if (id) keys.push(`#${id}`);
    for (const cls of classes) keys.push(`.${cls}`);
    for (const key of keys) {
      const existing = map.get(key) ?? {};
      // Don't overwrite existing CSS rule decls — inline fills gaps only.
      map.set(key, { ...inlineDecls, ...existing });
    }
  }
}

/**
 * Selectors a tag matches: `#id` (if present), `.cls` for every class.
 * Used to look up a tag's effective decls in the selector → DeclMap.
 */
function tagSelectorKeys(tag: OpenTag): string[] {
  const keys: string[] = [];
  const id = readAttr(tag.raw, "id");
  if (id) keys.push(`#${id}`);
  const classes = (readAttr(tag.raw, "class") || "").split(/\s+/).filter(Boolean);
  for (const cls of classes) keys.push(`.${cls}`);
  return keys;
}

function lookupDeclsForTag(tag: OpenTag, map: Map<string, DeclMap>): DeclMap {
  const merged: DeclMap = {};
  for (const key of tagSelectorKeys(tag)) {
    const decls = map.get(key);
    if (!decls) continue;
    Object.assign(merged, decls);
  }
  // Inline always wins for the tag's own resolved state.
  const inline = parseInlineStyle(readAttr(tag.raw, "style"));
  Object.assign(merged, inline);
  return merged;
}

function hasPositionAbsolute(decls: DeclMap): boolean {
  const pos = (decls.position || "").toLowerCase();
  return pos === "absolute" || pos === "fixed";
}

function hasResolvedWidth(decls: DeclMap): boolean {
  if (decls.width) return true;
  if (decls.inset) return true;
  if (decls.left && decls.right) return true;
  return false;
}

const PERCENT_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/;

function isPercentValue(value: string | undefined): boolean {
  if (!value) return false;
  return PERCENT_PATTERN.test(value);
}

const FIFTY_PERCENT_PATTERN = /^\s*50\s*%\s*$/;

function hasTranslate(decls: DeclMap, axis: "x" | "y"): boolean {
  const transform = (decls.transform || "").toLowerCase();
  if (!transform) return false;
  if (axis === "x") {
    if (/translate\s*\(\s*-50%/.test(transform)) return true;
    if (/translatex\s*\(\s*-50%/.test(transform)) return true;
  } else {
    if (/translate\s*\(\s*[^,]+,\s*-50%/.test(transform)) return true;
    if (/translatey\s*\(\s*-50%/.test(transform)) return true;
  }
  return false;
}

function hasNegativeMarginCompensation(decls: DeclMap, axis: "x" | "y"): boolean {
  const prop = axis === "x" ? decls["margin-left"] : decls["margin-top"];
  if (!prop) return false;
  return /^\s*-/.test(prop);
}

/**
 * Walk the open-tag stack to find the parent element of a given tag. Returns
 * null when we can't determine the parent reliably (tag is root, or stack
 * tracking diverges). Best-effort — we do not parse the full DOM, only track
 * open/close pairs by tagname in document order.
 */
function findParentTag(source: string, tags: OpenTag[], target: OpenTag): OpenTag | null {
  const stack: OpenTag[] = [];
  const closeRe = /<\s*\/\s*([a-z][\w:-]*)\s*>/gi;
  const closes: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = closeRe.exec(source)) !== null) {
    closes.push({ name: (m[1] || "").toLowerCase(), index: m.index });
  }
  let closeIdx = 0;
  for (const tag of tags) {
    // Pop any closes that occurred before this open tag.
    while (closeIdx < closes.length && closes[closeIdx]!.index < tag.index) {
      const closeName = closes[closeIdx]!.name;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name === closeName) {
          stack.splice(i, 1);
          break;
        }
      }
      closeIdx += 1;
    }
    if (tag === target) {
      return stack[stack.length - 1] ?? null;
    }
    // Void elements never push onto the stack.
    const isVoid =
      /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag.name);
    const isSelfClosing = /\/\s*>$/.test(tag.raw);
    if (!isVoid && !isSelfClosing) stack.push(tag);
  }
  return null;
}

/**
 * Compute the end index (close tag position) of an open tag by tracking
 * nesting depth of same-named tags. Used to scope descendant searches.
 */
function findTagEndIndex(source: string, tag: OpenTag): number {
  const name = tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<\\s*/?\\s*${name}\\b[^>]*>`, "gi");
  pattern.lastIndex = tag.index;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0];
    const isClose = /^<\s*\//.test(raw);
    const isSelfClose = /\/\s*>$/.test(raw);
    if (!isClose && !isSelfClose) depth += 1;
    if (isClose) depth -= 1;
    if (depth <= 0) return match.index + raw.length;
  }
  return source.length;
}

// ── Minimal CSS selector matcher ────────────────────────────────────────────
// Supports `.cls`, `#id`, `tag`, descendant (` `), child (`>`), and selector
// lists (`,`). Out of scope: pseudo-classes (`:hover`), pseudo-elements
// (`::before`), attribute selectors (`[data-x]`), and sibling combinators
// (`+`/`~`). These are skipped — we treat them as non-matches conservatively
// since selector-level GSAP/CSS conflicts in v1 only need class/id/tag/descendant
// resolution.
type SimpleSelectorPart = { kind: "tag" | "class" | "id"; value: string };
type CompoundSelector = SimpleSelectorPart[];
type CombinedSelector = Array<{ compound: CompoundSelector; combinator: " " | ">" | "start" }>;

function parseSimpleSelector(token: string): CompoundSelector | null {
  // Reject anything with pseudo / attribute selectors; return null so the
  // caller can fall back to exact-string match instead.
  if (/[:[]/.test(token)) return null;
  const parts: CompoundSelector = [];
  // Split into pieces: an initial tag (or nothing), then runs of `.cls` / `#id`.
  const re = /([a-zA-Z][\w-]*)|(\.[\w-]+)|(#[\w-]+)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(token)) !== null) {
    const matched = m[0];
    if (m.index !== consumed) return null; // non-contiguous = unsupported syntax
    consumed += matched.length;
    if (matched.startsWith(".")) parts.push({ kind: "class", value: matched.slice(1) });
    else if (matched.startsWith("#")) parts.push({ kind: "id", value: matched.slice(1) });
    else parts.push({ kind: "tag", value: matched.toLowerCase() });
  }
  if (consumed !== token.length) return null;
  if (parts.length === 0) return null;
  return parts;
}

function parseCssSelector(selector: string): CombinedSelector[] | null {
  // Returns one CombinedSelector per comma-separated alternative. Null on
  // unsupported syntax (pseudo, attribute, sibling combinators).
  const out: CombinedSelector[] = [];
  for (const alt of selector.split(",")) {
    const trimmed = alt.trim();
    if (!trimmed) continue;
    if (/[~+]/.test(trimmed)) return null; // sibling combinators unsupported
    if (trimmed === "*") continue; // universal — handled by caller
    const tokens = trimmed.split(/\s+/);
    const combined: CombinedSelector = [];
    let pendingCombinator: " " | ">" | "start" = "start";
    for (const tk of tokens) {
      if (tk === ">") {
        pendingCombinator = ">";
        continue;
      }
      const compound = parseSimpleSelector(tk);
      if (!compound) return null;
      combined.push({ compound, combinator: pendingCombinator });
      pendingCombinator = " ";
    }
    if (combined.length > 0) out.push(combined);
  }
  return out.length > 0 ? out : null;
}

function compoundMatchesTag(compound: CompoundSelector, tag: OpenTag): boolean {
  const id = readAttr(tag.raw, "id") || "";
  const classes = (readAttr(tag.raw, "class") || "").split(/\s+/).filter(Boolean);
  for (const part of compound) {
    if (part.kind === "tag") {
      if (tag.name.toLowerCase() !== part.value) return false;
    } else if (part.kind === "id") {
      if (id !== part.value) return false;
    } else if (part.kind === "class") {
      if (!classes.includes(part.value)) return false;
    }
  }
  return true;
}

/**
 * Test whether a CSS rule selector matches the given tag, with ancestor
 * resolution via the open-tag stack. Returns false on unsupported selector
 * syntax (caller should fall back to exact-string match).
 */
function selectorMatchesTag(
  source: string,
  tags: OpenTag[],
  cssSelector: string,
  targetTag: OpenTag,
): boolean {
  const parsed = parseCssSelector(cssSelector);
  if (!parsed) return false;
  // Build ancestor chain for target.
  const ancestors: OpenTag[] = [];
  let cur: OpenTag | null = targetTag;
  // Guard against pathological inputs.
  let safety = 0;
  while (cur && safety++ < 64) {
    const parent = findParentTag(source, tags, cur);
    if (!parent) break;
    ancestors.unshift(parent);
    cur = parent;
  }

  for (const alt of parsed) {
    // Match the final compound against the target.
    const last = alt[alt.length - 1]!;
    if (!compoundMatchesTag(last.compound, targetTag)) continue;
    if (alt.length === 1) return true;
    // Walk leftward through compounds, satisfying combinators against ancestors.
    let ancestorIdx = ancestors.length - 1;
    let ok = true;
    for (let i = alt.length - 2; i >= 0; i--) {
      const piece = alt[i]!;
      const nextPiece = alt[i + 1]!;
      if (nextPiece.combinator === ">") {
        // Strict parent match.
        const parent = ancestors[ancestorIdx];
        if (!parent || !compoundMatchesTag(piece.compound, parent)) {
          ok = false;
          break;
        }
        ancestorIdx -= 1;
      } else {
        // Descendant: walk ancestors until match.
        let matched = false;
        while (ancestorIdx >= 0) {
          if (compoundMatchesTag(piece.compound, ancestors[ancestorIdx]!)) {
            matched = true;
            ancestorIdx -= 1;
            break;
          }
          ancestorIdx -= 1;
        }
        if (!matched) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Test whether a CSS rule selector would match ANY tag whose simple
 * selector keys (id/class) overlap a target string T. Used when we have a
 * GSAP target selector string (e.g. `.box`) and a CSS rule like
 * `.scene .box { ... }` — we want to recognize that ANY `.box` element
 * inside a `.scene` is covered.
 *
 * We do this by finding tags matching the GSAP target string, then asking
 * `selectorMatchesTag` for each. If any match, return true.
 */
function cssSelectorCoversTarget(
  source: string,
  tags: OpenTag[],
  cssSelector: string,
  targetSelector: string,
): boolean {
  // Exact match short-circuit (cheap path, no ancestor walk).
  if (cssSelector.trim() === targetSelector.trim()) return true;
  // The target selector must itself be simple — `.cls` / `#id` / `tag` /
  // a comma-separated list. Anything more complex falls back to exact.
  const targetCompound = parseSimpleSelector(targetSelector.trim());
  if (!targetCompound) return false;
  for (const tag of tags) {
    if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
    if (!compoundMatchesTag(targetCompound, tag)) continue;
    if (selectorMatchesTag(source, tags, cssSelector, tag)) return true;
  }
  return false;
}

function directChildTags(source: string, tags: OpenTag[], parent: OpenTag): OpenTag[] {
  const parentEnd = findTagEndIndex(source, parent);
  const children: OpenTag[] = [];
  let i = 0;
  for (; i < tags.length; i++) if (tags[i] === parent) break;
  i += 1; // first candidate is the tag right after parent
  const cursor = { idx: parent.index };
  while (i < tags.length && tags[i]!.index < parentEnd) {
    const candidate = tags[i]!;
    // A direct child is the next open tag whose own end falls before the next
    // tag in the source — i.e. not nested deeper than 1 level under parent.
    if (candidate.index >= cursor.idx) {
      children.push(candidate);
      cursor.idx = findTagEndIndex(source, candidate);
    }
    i += 1;
  }
  return children;
}

// ── Rule helpers ────────────────────────────────────────────────────────────

// Selectors used by the captions-only `caption_text_overflow_risk` rule. We
// skip these here so the broader `nowrap_missing_max_width` rule doesn't
// double-emit on caption files.
const CAPTION_SELECTOR_PATTERN =
  /(\.caption[-_]?(?:group|container|text|line|word)|#caption[-_]?container)/i;

// ── Rules ───────────────────────────────────────────────────────────────────

export const layoutRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // ── 1. absolute_width_collapse ──────────────────────────────────────────
  // A `position: absolute` child with `width: <percent>` resolves against a
  // parent that has `max-width:` only (no `width:`, no `inset:`, no left+right
  // pair). The parent shrink-to-fits to 0, and the child's percentage width
  // resolves to 0px — text wraps at every space.
  ({ source, tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);
    const reported = new Set<string>();

    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const decls = lookupDeclsForTag(tag, declMap);
      if (!hasPositionAbsolute(decls)) continue;
      if (!isPercentValue(decls.width)) continue;

      const parent = findParentTag(source, tags, tag);
      if (!parent) continue;
      const parentDecls = lookupDeclsForTag(parent, declMap);
      if (!parentDecls["max-width"]) continue;
      if (hasResolvedWidth(parentDecls)) continue;

      // Skip if parent is a properly-sized flex/grid container.
      const display = (parentDecls.display || "").toLowerCase();
      if ((display === "flex" || display === "grid") && parentDecls.width === "100%") continue;

      const childSelector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
      const parentSelector = tagSelectorKeys(parent)[0] ?? `<${parent.name}>`;
      const dedupeKey = `${parentSelector}|${childSelector}`;
      if (reported.has(dedupeKey)) continue;
      reported.add(dedupeKey);

      findings.push({
        code: "absolute_width_collapse",
        severity: "error",
        message:
          `Container \`${parentSelector}\` caps with \`max-width\` but has no resolved \`width:\` ` +
          `— its intrinsic width collapses to 0 because child \`${childSelector}\` is ` +
          "`position: absolute`. The child resolves `width: 100%` against 0px and wraps every word.",
        selector: childSelector,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint:
          `Fix \`${parentSelector}\` by adding \`width: 100%\` (so \`max-width\` has a base to cap from), ` +
          "or `width: 1600px` (fixed), or replace the absolute-children layout with " +
          "`position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; " +
          "padding: 0 160px; box-sizing: border-box;`.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 2. absolute_center_missing_translate ────────────────────────────────
  // `left: 50%` / `top: 50%` lands the corner at center, not the midpoint.
  // The element needs `transform: translate(-50%, -50%)` (or per-axis
  // translate) — or legacy negative-margin compensation. Otherwise it's
  // offset by half its size.
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);
    const reported = new Set<string>();

    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const decls = lookupDeclsForTag(tag, declMap);
      if (!hasPositionAbsolute(decls)) continue;

      const leftIs50 = FIFTY_PERCENT_PATTERN.test(decls.left || "");
      const topIs50 = FIFTY_PERCENT_PATTERN.test(decls.top || "");
      if (!leftIs50 && !topIs50) continue;

      const missingX =
        leftIs50 && !hasTranslate(decls, "x") && !hasNegativeMarginCompensation(decls, "x");
      const missingY =
        topIs50 && !hasTranslate(decls, "y") && !hasNegativeMarginCompensation(decls, "y");
      if (!missingX && !missingY) continue;

      const selector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
      if (reported.has(selector)) continue;
      reported.add(selector);

      const axisDesc =
        missingX && missingY ? "left: 50% / top: 50%" : missingX ? "left: 50%" : "top: 50%";
      findings.push({
        code: "absolute_center_missing_translate",
        severity: "warning",
        message:
          `\`${selector}\` uses \`${axisDesc}\` for centering but has no ` +
          "`transform: translate(-50%, -50%)` — the element's top-left corner lands at center, " +
          "not its midpoint, so it's offset by half its size.",
        selector,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint:
          "Add `transform: translate(-50%, -50%)` (or `translateX(-50%)` / `translateY(-50%)` for " +
          "the axis you're centering). Prefer flexbox: `display: flex; align-items: center; " +
          "justify-content: center;` on the parent — it avoids sub-pixel jitter from percent-translate centering.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 3. word_stagger_block_display ───────────────────────────────────────
  // Per-word stagger spans (`.word`) MUST be `display: inline-block`. With
  // `display: block` each word lands on its own line and the stagger
  // becomes a per-line vertical reveal.
  ({ tags, styles, scripts }) => {
    const findings: HyperframeLintFinding[] = [];

    // Heuristic gate: require BOTH (a) a word-like selector in styles AND
    // (b) evidence of GSAP stagger usage in scripts. Without both, the
    // `.word` class is likely an unrelated badge / token (e.g. a word-count
    // pill), not a per-word stagger composition.
    const wordSelectorInStyles = styles.some((s) =>
      /\.caption[-_]?(?:group|word)|\.word\b|\[data-word/i.test(s.content),
    );
    const wordSelectorOnTag = tags.some(
      (t) =>
        /\bword\b/.test(readAttr(t.raw, "class") || "") || readAttr(t.raw, "data-word") !== null,
    );
    const hasWordEvidence = wordSelectorInStyles || wordSelectorOnTag;

    // Detect GSAP stagger usage in scripts. We accept either an explicit
    // `stagger:` key in a tween config, or a GSAP target string that names
    // a word-like selector (`.word`, `.caption-word`, `[data-word]`). We
    // use a negative lookahead `(?![\w-])` instead of `\b` so the matcher
    // doesn't falsely fire on `.word-count` or `.wordmark`.
    const gsapStaggerUsage = scripts.some((s) => {
      const c = s.content;
      const hasStaggerKey = /\bstagger\s*:/.test(c);
      const hasGsapWordTarget =
        /gsap\.(?:to|from|fromTo|set|timeline)[\s\S]{0,80}["'][^"']*\.(?:caption[-_]?)?word(?![\w-])/.test(
          c,
        ) ||
        /\.(?:to|from|fromTo|set)\s*\(\s*["'][^"']*\.(?:caption[-_]?)?word(?![\w-])/.test(c) ||
        /["'][^"']*\[data-word(?![\w-])[^"']*["']/.test(c);
      return hasStaggerKey || hasGsapWordTarget;
    });

    if (!hasWordEvidence || !gsapStaggerUsage) return findings;

    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);
    const reported = new Set<string>();

    const isBlockLevelDisplay = (value: string | undefined) => {
      const v = (value || "").toLowerCase();
      return v === "block" || v === "flex" || v === "grid";
    };

    // CSS rules pass: emit per matching word-selector.
    const wordSelectorRe =
      /(?:^|\s|,)(\.word\b|\.caption[-_]?word\b|\.cw-[\w-]+|span\.word\b|\[data-word\b)/i;
    for (const [selector, decls] of declMap) {
      if (!wordSelectorRe.test(selector)) continue;
      if (!isBlockLevelDisplay(decls.display)) continue;
      if (reported.has(selector)) continue;
      reported.add(selector);
      findings.push({
        code: "word_stagger_block_display",
        severity: "warning",
        message:
          `Word span \`${selector}\` uses \`display: ${decls.display}\` — every word will stack on its own line, ` +
          "breaking left-to-right reading order and turning a per-word stagger into a per-line vertical reveal.",
        selector,
        fixHint:
          "Use `display: inline-block` — it accepts `transform`, `scale`, and `y` tweens without " +
          "disrupting inline flow.",
      });
    }

    // Inline-style pass on <span> tags that look like word elements.
    for (const tag of tags) {
      if (tag.name !== "span") continue;
      const classAttr = readAttr(tag.raw, "class") || "";
      const isWordSpan =
        /\bword\b/.test(classAttr) ||
        /\bcaption[-_]?word\b/.test(classAttr) ||
        /\bcw-/.test(classAttr) ||
        readAttr(tag.raw, "data-word") !== null;
      if (!isWordSpan) continue;
      const inline = parseInlineStyle(readAttr(tag.raw, "style"));
      if (!isBlockLevelDisplay(inline.display)) continue;
      const key = tag.raw;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push({
        code: "word_stagger_block_display",
        severity: "warning",
        message:
          `Word span \`<span class="${classAttr}">\` uses inline \`display: ${inline.display}\` — ` +
          "every word will stack on its own line, breaking left-to-right reading order.",
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint:
          "Use `display: inline-block` so the span accepts transform/scale tweens without disrupting inline flow.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 4. hero_absolute_center_maxwidth_only ──────────────────────────────
  // The canonical width-collapse anti-pattern, called out with a sharper
  // message than the generic `absolute_width_collapse`. Triggers when one
  // selector has all of: absolute, left:50%, top:50%, translate centering,
  // max-width, AND no `width:`.
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);
    const reported = new Set<string>();

    const check = (selector: string, decls: DeclMap, tag?: OpenTag) => {
      if (!hasPositionAbsolute(decls)) return;
      if (!FIFTY_PERCENT_PATTERN.test(decls.left || "")) return;
      if (!FIFTY_PERCENT_PATTERN.test(decls.top || "")) return;
      const transform = (decls.transform || "").toLowerCase();
      const hasTranslateCentering =
        /translate\s*\(\s*-50%\s*,\s*-50%/.test(transform) ||
        (/translatex\s*\(\s*-50%/.test(transform) && /translatey\s*\(\s*-50%/.test(transform));
      if (!hasTranslateCentering) return;
      if (!decls["max-width"]) return;
      if (decls.width) return;
      if (reported.has(selector)) return;
      reported.add(selector);
      findings.push({
        code: "hero_absolute_center_maxwidth_only",
        severity: "error",
        message:
          `\`${selector}\` is the canonical width-collapse anti-pattern ` +
          "(`position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); max-width:Npx;` " +
          "with no `width:`). With absolute positioning, `max-width` caps an auto-sized container " +
          "at 0 intrinsic width and any child `width:100%` resolves against 0px.",
        selector,
        elementId: tag ? readAttr(tag.raw, "id") || undefined : undefined,
        fixHint:
          "Either set explicit `width: Npx`, or replace with `position: absolute; inset: 0; " +
          "display: flex; align-items: center; justify-content: center; padding: 0 Npx; " +
          "box-sizing: border-box;`.",
        snippet: tag ? truncateSnippet(tag.raw) : undefined,
      });
    };

    // CSS rules.
    for (const [selector, decls] of declMap) {
      // Skip selectors derived from inline-style fill-ins (these will be
      // checked through the tag pass below to attach a proper snippet).
      if (selector.startsWith("#") || selector.startsWith(".")) {
        check(selector, decls);
      }
    }
    // Inline-style pass with snippet attached.
    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const inline = parseInlineStyle(readAttr(tag.raw, "style"));
      if (Object.keys(inline).length === 0) continue;
      const selector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
      check(selector, inline, tag);
    }
    return findings;
  },

  // ── 5. nowrap_missing_max_width ─────────────────────────────────────────
  // Generalization of `caption_text_overflow_risk` (captions-only). Skips
  // caption selectors so we don't double-emit on caption files.
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);
    const reported = new Set<string>();

    for (const [selector, decls] of declMap) {
      if (CAPTION_SELECTOR_PATTERN.test(selector)) continue;
      if ((decls["white-space"] || "").toLowerCase() !== "nowrap") continue;
      if (decls["max-width"]) continue;
      if (decls.width) continue;
      if (decls.inset) continue;
      if (decls.left && decls.right) continue;
      if (reported.has(selector)) continue;
      reported.add(selector);
      findings.push({
        code: "nowrap_missing_max_width",
        severity: "warning",
        message:
          `\`${selector}\` uses \`white-space: nowrap\` with no bounding width. ` +
          "Long phrases will clip off-screen at render time.",
        selector,
        fixHint:
          "Add `max-width: 1600px` (landscape) or `max-width: 900px` (portrait), or set an explicit " +
          "`width:`, or use `overflow: hidden` if intentional clipping is desired.",
      });
    }

    // Inline-style scan for non-caption tags.
    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const inline = parseInlineStyle(readAttr(tag.raw, "style"));
      if ((inline["white-space"] || "").toLowerCase() !== "nowrap") continue;
      if (inline["max-width"] || inline.width || inline.inset) continue;
      if (inline.left && inline.right) continue;
      const selector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
      if (CAPTION_SELECTOR_PATTERN.test(selector)) continue;
      if (reported.has(selector)) continue;
      reported.add(selector);
      findings.push({
        code: "nowrap_missing_max_width",
        severity: "warning",
        message:
          `\`${selector}\` (inline style) uses \`white-space: nowrap\` with no bounding width. ` +
          "Long phrases will clip off-screen at render time.",
        selector,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint:
          "Add `max-width: 1600px` (landscape) or `max-width: 900px` (portrait), set an explicit " +
          "`width:`, or use `overflow: hidden` if intentional clipping is desired.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 7. gsap_css_transition_conflict ─────────────────────────────────────
  // CSS `transition` on a property that GSAP also animates causes a
  // double-animation lag.
  ({ scripts, styles, tags, source }) => {
    const findings: HyperframeLintFinding[] = [];
    if (!scripts.some((s) => /gsap\.(to|from|fromTo|set|timeline)/.test(s.content)))
      return findings;

    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);

    // Map of selector → set of CSS-transitioned property names.
    const transitionedProps = new Map<string, Set<string>>();
    const parseTransitionProps = (value: string): string[] => {
      const v = value.trim().toLowerCase();
      if (!v || v === "none" || v === "unset" || v === "initial") return [];
      // Each layer is comma-separated. First identifier of each layer is the
      // property name (defaults to `all` if a time appears first).
      const props: string[] = [];
      for (const layer of v.split(",")) {
        const trimmed = layer.trim();
        if (!trimmed) continue;
        const first = trimmed.split(/\s+/)[0] || "";
        // Skip pure durations (e.g. `0.3s`, `300ms`).
        if (/^\d/.test(first)) {
          props.push("all");
          continue;
        }
        props.push(first);
      }
      return props;
    };

    for (const [selector, decls] of declMap) {
      const propsSet = new Set<string>();
      if (decls.transition) {
        for (const p of parseTransitionProps(decls.transition)) {
          // Skip when transition explicitly is 0 duration.
          if (/\b0s\b/.test(decls.transition)) continue;
          propsSet.add(p);
        }
      }
      if (decls["transition-property"]) {
        for (const p of decls["transition-property"]
          .toLowerCase()
          .split(",")
          .map((s) => s.trim())) {
          if (p && p !== "none") propsSet.add(p);
        }
      }
      if (propsSet.size > 0) transitionedProps.set(selector, propsSet);
    }
    if (transitionedProps.size === 0) return findings;

    // GSAP → CSS property mapping.
    const gsapToCss: Record<string, string[]> = {
      x: ["transform"],
      y: ["transform"],
      xpercent: ["transform"],
      ypercent: ["transform"],
      scale: ["transform"],
      scalex: ["transform"],
      scaley: ["transform"],
      rotation: ["transform"],
      rotate: ["transform"],
      rotationx: ["transform"],
      rotationy: ["transform"],
      skewx: ["transform"],
      skewy: ["transform"],
      autoalpha: ["opacity", "visibility"],
      opacity: ["opacity"],
      backgroundcolor: ["background-color"],
      borderradius: ["border-radius"],
      color: ["color"],
      filter: ["filter"],
      backdropfilter: ["backdrop-filter"],
      width: ["width"],
      height: ["height"],
    };

    const tweenRe =
      /\.(?:to|from|fromTo|set)\s*\(\s*["']([^"']+)["']\s*,\s*(\{[^}]*\}(?:\s*,\s*\{[^}]*\})?)/g;
    const propKeyRe = /(?:^|[{,\s])([a-zA-Z][a-zA-Z0-9_]*)\s*:/g;

    const reported = new Set<string>();

    // Helper: collect the union of transitioned CSS props for any CSS rule
    // whose selector covers the GSAP target. Handles compound selectors
    // like `.scene .box { transition: transform }` against GSAP `.box`.
    const collectTransitionedProps = (gsapTarget: string): Set<string> => {
      const props = new Set<string>();
      for (const [cssSelector, cssProps] of transitionedProps) {
        if (cssSelectorCoversTarget(source, tags, cssSelector, gsapTarget)) {
          for (const p of cssProps) props.add(p);
        }
      }
      return props;
    };

    for (const script of scripts) {
      const content = script.content;
      let m: RegExpExecArray | null;
      tweenRe.lastIndex = 0;
      while ((m = tweenRe.exec(content)) !== null) {
        const selector = m[1] || "";
        const propsBlob = m[2] || "";
        const cssProps = collectTransitionedProps(selector);
        if (cssProps.size === 0) continue;

        const gsapProps = new Set<string>();
        let pm: RegExpExecArray | null;
        propKeyRe.lastIndex = 0;
        while ((pm = propKeyRe.exec(propsBlob)) !== null) {
          gsapProps.add((pm[1] || "").toLowerCase());
        }
        if (gsapProps.size === 0) continue;

        const conflictingCss = new Set<string>();
        for (const gp of gsapProps) {
          const mapped = gsapToCss[gp] || [];
          for (const cp of mapped) {
            if (cssProps.has(cp) || cssProps.has("all")) conflictingCss.add(cp);
          }
        }
        if (conflictingCss.size === 0) continue;

        const propList = [...conflictingCss].join(", ");
        const key = `${selector}|${propList}`;
        if (reported.has(key)) continue;
        reported.add(key);

        findings.push({
          code: "gsap_css_transition_conflict",
          severity: "warning",
          message:
            `\`${selector}\` has CSS \`transition: ${propList}\` AND GSAP animates ${propList} on the same element — ` +
            "the CSS transition interpolates between every GSAP keyframe value and creates a double-animation lag.",
          selector,
          fixHint:
            "Remove the CSS `transition:` declaration; GSAP already interpolates. If you need the CSS " +
            "transition for hover/state outside the timeline, scope it via a class that GSAP isn't targeting.",
          snippet: truncateSnippet(m[0]),
        });
      }
    }
    return findings;
  },

  // ── 8. canvas_missing_dimensions ────────────────────────────────────────
  // Bare <canvas> defaults to 300×150. Any draw before `canvas.width = W`
  // renders at that size and stretches.
  ({ tags, scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    const scriptBlob = scripts.map((s) => s.content).join("\n");

    for (const tag of tags) {
      if (tag.name !== "canvas") continue;
      const hasWidth = readAttr(tag.raw, "width") !== null;
      const hasHeight = readAttr(tag.raw, "height") !== null;
      if (hasWidth && hasHeight) continue;

      const id = readAttr(tag.raw, "id");
      // Heuristic: if JS assigns width/height to this canvas, suppress.
      let assignedInJs = false;
      if (id) {
        const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const idAssignRe = new RegExp(
          `getElementById\\s*\\(\\s*["']${esc}["']\\s*\\)[\\s\\S]{0,200}\\.width\\s*=`,
        );
        const idHeightRe = new RegExp(
          `getElementById\\s*\\(\\s*["']${esc}["']\\s*\\)[\\s\\S]{0,200}\\.height\\s*=`,
        );
        if (idAssignRe.test(scriptBlob) && idHeightRe.test(scriptBlob)) assignedInJs = true;
      }
      // Generic: `canvas.width = ` somewhere in scripts.
      if (
        !assignedInJs &&
        /\bcanvas\.width\s*=\s*\d/.test(scriptBlob) &&
        /\bcanvas\.height\s*=\s*\d/.test(scriptBlob)
      ) {
        assignedInJs = true;
      }
      if (assignedInJs) continue;

      findings.push({
        code: "canvas_missing_dimensions",
        severity: "warning",
        message:
          `<canvas${id ? ` id="${id}"` : ""}> has no \`width=\` / \`height=\` attribute — it defaults to 300×150. ` +
          "Any draw call before your `canvas.width = W` assignment renders at the default size and stretches.",
        elementId: id || undefined,
        fixHint:
          'Add explicit HTML attributes: `<canvas width="1920" height="1080" ...>` even if you also assign in JS.',
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 9. cross_project_asset_url ──────────────────────────────────────────
  // `hyperframes-<hash>/...` URLs that reference a *different* project will
  // silently 404 if that project is cleaned up.
  ({ source, options }) => {
    const findings: HyperframeLintFinding[] = [];
    const filePath = options.filePath || "";
    // Try to extract the current project's hash from filePath. Acceptable
    // false-negative: when filePath doesn't include a `hyperframes-<hash>`
    // segment, we skip entirely to avoid false positives in standalone runs.
    const currentHashMatch = filePath.match(/hyperframes-([a-f0-9]{8,})/i);
    if (!currentHashMatch) return findings;
    const currentHash = currentHashMatch[1]!.toLowerCase();

    const urlRe = /hyperframes-([a-f0-9]{8,})/gi;
    // Collect all URLs in @font-face / src= / href= references.
    const seen = new Set<string>();
    // @font-face src.
    const fontFaceRe = /@font-face\s*\{[^}]*src\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = fontFaceRe.exec(source)) !== null) {
      const url = m[1] || "";
      const hashMatch = url.match(urlRe);
      if (!hashMatch) continue;
      for (const hm of hashMatch) {
        const otherHash = hm.replace(/hyperframes-/i, "").toLowerCase();
        if (otherHash === currentHash) continue;
        const key = `${url}|${otherHash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          code: "cross_project_asset_url",
          severity: "warning",
          message:
            `Asset URL \`${url.slice(0, 120)}\` references project \`hyperframes-${otherHash}\` but ` +
            `this composition belongs to \`hyperframes-${currentHash}\`. If the other project is ever ` +
            "cleaned up the asset silently 404s — fonts fall back to a system font, images become broken icons.",
          fixHint:
            "Copy the asset into this project's `/assets/` directory at capture time and rewrite the URL " +
            "to a relative path.",
          snippet: truncateSnippet(m[0]),
        });
      }
    }
    // <img>/<video>/<audio>/<source> src=
    const srcTagRe = /<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    while ((m = srcTagRe.exec(source)) !== null) {
      const url = m[1] || "";
      const hashMatch = url.match(urlRe);
      if (!hashMatch) continue;
      for (const hm of hashMatch) {
        const otherHash = hm.replace(/hyperframes-/i, "").toLowerCase();
        if (otherHash === currentHash) continue;
        const key = `${url}|${otherHash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          code: "cross_project_asset_url",
          severity: "warning",
          message:
            `Asset URL \`${url.slice(0, 120)}\` references project \`hyperframes-${otherHash}\` but ` +
            `this composition belongs to \`hyperframes-${currentHash}\`. If the other project is ever ` +
            "cleaned up the asset silently 404s.",
          fixHint:
            "Copy the asset into this project's `/assets/` directory at capture time and rewrite the URL " +
            "to a relative path.",
          snippet: truncateSnippet(m[0]),
        });
      }
    }
    return findings;
  },

  // ── 9b. invalid_absolute_url_prefix ─────────────────────────────────────
  // `<img src="../https://...">` / `url("../https://...")` — the `../`
  // prefix turns what should be an absolute HTTPS URL into a relative
  // resolve, which 404s silently. Observed in Mercury session 2915a2fd
  // (22 hits). Images and fonts fall back to broken icons / system fonts
  // with no visible error.
  //
  // Detection: regex-scan every tag attribute value (`src=`, `href=`) and
  // every CSS `url(...)` reference for `(../)+https?://...`. Deduplicate
  // by malformed URL so a single broken URL doesn't fire multiple times
  // from both a `<link>` and an `@font-face` rule.
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    // Core matcher: one or more `../` segments immediately followed by an
    // `http://` or `https://` scheme. The URL body captures anything up to
    // the closing quote / paren / whitespace.
    const MALFORMED_URL_RE = /(?:\.\.\/)+https?:\/\/[^\s)"']+/g;
    const reported = new Set<string>();

    const emit = (url: string, snippet: string, selector?: string, elementId?: string) => {
      if (reported.has(url)) return;
      reported.add(url);
      findings.push({
        code: "invalid_absolute_url_prefix",
        severity: "error",
        message:
          `Malformed URL '${url}' has a \`../\` prefix that turns it into a relative resolve → 404. ` +
          "Remove the `../` prefix.",
        selector,
        elementId,
        fixHint:
          `Strip the leading \`../\` (and any additional \`../\` segments) so the URL becomes a clean ` +
          `absolute HTTPS reference: \`${url.replace(/^(?:\.\.\/)+/, "")}\`.`,
        snippet: truncateSnippet(snippet),
      });
    };

    // 1. Walk every open tag and inspect `src=` / `href=` attribute values.
    //    This covers <img>, <video>, <audio>, <source>, <track>, <link>,
    //    <a>, <iframe>, and any future tag that uses these attrs.
    for (const tag of tags) {
      for (const attrName of ["src", "href"] as const) {
        const value = readAttr(tag.raw, attrName);
        if (!value) continue;
        MALFORMED_URL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = MALFORMED_URL_RE.exec(value)) !== null) {
          const url = m[0];
          const id = readAttr(tag.raw, "id");
          emit(url, tag.raw, `<${tag.name} ${attrName}>`, id || undefined);
        }
      }
    }

    // 2. Walk every <style> block (and external stylesheet content) for
    //    CSS `url(...)` references — covers `@font-face { src: url(...) }`,
    //    `background-image: url(...)`, mask-image, cursor, etc.
    const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    for (const style of styles) {
      CSS_URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CSS_URL_RE.exec(style.content)) !== null) {
        const cssUrl = m[1] || "";
        MALFORMED_URL_RE.lastIndex = 0;
        let inner: RegExpExecArray | null;
        while ((inner = MALFORMED_URL_RE.exec(cssUrl)) !== null) {
          emit(inner[0], m[0]);
        }
      }
    }

    // 3. Inline `style="background-image: url(...)"` on tags — readAttr
    //    pulls the whole style string; reuse the same CSS_URL_RE matcher.
    for (const tag of tags) {
      const inlineStyle = readAttr(tag.raw, "style");
      if (!inlineStyle) continue;
      CSS_URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CSS_URL_RE.exec(inlineStyle)) !== null) {
        const cssUrl = m[1] || "";
        MALFORMED_URL_RE.lastIndex = 0;
        let inner: RegExpExecArray | null;
        while ((inner = MALFORMED_URL_RE.exec(cssUrl)) !== null) {
          const id = readAttr(tag.raw, "id");
          emit(inner[0], tag.raw, `<${tag.name} style>`, id || undefined);
        }
      }
    }

    return findings;
  },

  // ── 10. viewport_units_in_fixed_composition ─────────────────────────────
  // `vw`/`vh` resolve against the browser viewport, NOT the fixed composition
  // dimensions. In headless capture the viewport may be 800×600 while the
  // composition is 1920×1080.
  ({ tags, styles, rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    // Only run on fixed-size compositions.
    if (!rootTag) return findings;
    const widthAttr = readAttr(rootTag.raw, "data-width");
    const heightAttr = readAttr(rootTag.raw, "data-height");
    const w = widthAttr ? Number(widthAttr) : NaN;
    const h = heightAttr ? Number(heightAttr) : NaN;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return findings;

    const VIEWPORT_UNIT_RE = /(\d+(?:\.\d+)?)\s*(vw|vh|vmin|vmax)\b/i;
    const seen = new Set<string>();

    const emit = (selector: string, prop: string, value: string, tag?: OpenTag) => {
      const m = value.match(VIEWPORT_UNIT_RE);
      if (!m) return;
      const n = Number(m[1]);
      const unit = (m[2] || "").toLowerCase();
      let pxEquivalent: number | null = null;
      if (unit === "vw" && Number.isFinite(n)) pxEquivalent = Math.round((n * w) / 100);
      else if (unit === "vh" && Number.isFinite(n)) pxEquivalent = Math.round((n * h) / 100);

      const key = `${selector}|${prop}|${value}`;
      if (seen.has(key)) return;
      seen.add(key);

      const pxHint = pxEquivalent != null ? ` (${m[0]} of ${w}x${h} ≈ ${pxEquivalent}px)` : "";
      findings.push({
        code: "viewport_units_in_fixed_composition",
        severity: "warning",
        message:
          `Declaration \`${prop}: ${value}\` uses a viewport unit. In fixed-size compositions ` +
          `(\`${w}x${h}\`), viewport units resolve against the browser/iframe viewport ` +
          "(often 800×600 in headless capture), NOT against the composition dimensions.",
        selector,
        elementId: tag ? readAttr(tag.raw, "id") || undefined : undefined,
        fixHint: `Use px instead${pxHint ? `: ${pxHint.trim()}` : ""}.`,
        snippet: tag ? truncateSnippet(tag.raw) : undefined,
      });
    };

    for (const style of styles) {
      let root: postcss.Root;
      try {
        root = postcss.parse(style.content);
      } catch {
        continue;
      }
      root.walkDecls((decl) => {
        if (!VIEWPORT_UNIT_RE.test(decl.value)) return;
        const rule = decl.parent;
        if (!rule || rule.type !== "rule") return;
        const selectors = (rule as postcss.Rule).selectors ?? [];
        for (const s of selectors) emit(s, decl.prop, decl.value);
      });
    }

    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const inline = readAttr(tag.raw, "style");
      if (!inline) continue;
      const decls = parseInlineStyle(inline);
      for (const [prop, value] of Object.entries(decls)) {
        if (!VIEWPORT_UNIT_RE.test(value)) continue;
        const selector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
        emit(selector, prop, value, tag);
      }
    }
    return findings;
  },

  // ── 11. z_index_without_position ────────────────────────────────────────
  // `z-index` is a no-op on `position: static` (the default). Stacking falls
  // back to DOM order.
  //
  // FP fix: `#beat-1 { z-index: 2 }` is paired with `.scene { position: absolute }`
  // and the element carries BOTH selectors. Selector-keyed declMap can't see
  // that. For each candidate, look up the tag(s) in `ctx.tags` that the
  // selector matches, then walk ALL other CSS rules whose selectors also
  // match that tag — if any sibling rule sets a non-static `position`, the
  // z-index is effective and the warning is suppressed.
  ({ source, tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    const reported = new Set<string>();
    const NON_STATIC = new Set(["relative", "absolute", "fixed", "sticky"]);

    // For a given selector that triggered the rule, find every tag the
    // selector covers, and for each such tag ask whether ANY other selector
    // in declMap (or the tag's inline style) declares a non-static
    // `position`. If any does, the warning is a false positive.
    const tagHasSiblingPosition = (tag: OpenTag): boolean => {
      // Inline style on the tag itself wins.
      const inline = parseInlineStyle(readAttr(tag.raw, "style"));
      if (inline.position && NON_STATIC.has(inline.position.toLowerCase())) return true;
      for (const [siblingSelector, siblingDecls] of declMap) {
        if (!siblingDecls.position) continue;
        if (!NON_STATIC.has(siblingDecls.position.toLowerCase())) continue;
        if (selectorMatchesTag(source, tags, siblingSelector, tag)) return true;
      }
      return false;
    };

    const selectorHasEffectivePosition = (selector: string, decls: DeclMap): boolean => {
      // Rule's own position declaration takes precedence (already filtered
      // upstream, but kept for clarity).
      const pos = (decls.position || "static").toLowerCase();
      if (pos !== "static") return true;
      // Check whether any tag this selector matches has a sibling rule that
      // supplies a non-static position.
      for (const tag of tags) {
        if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name))
          continue;
        if (!selectorMatchesTag(source, tags, selector, tag)) continue;
        if (tagHasSiblingPosition(tag)) return true;
      }
      return false;
    };

    for (const [selector, decls] of declMap) {
      if (!decls["z-index"]) continue;
      if (decls["z-index"].trim().toLowerCase() === "auto") continue;
      const pos = (decls.position || "static").toLowerCase();
      if (pos !== "static") continue;
      if (selectorHasEffectivePosition(selector, decls)) continue;
      if (reported.has(selector)) continue;
      reported.add(selector);
      findings.push({
        code: "z_index_without_position",
        severity: "warning",
        message:
          `\`${selector}\` sets \`z-index: ${decls["z-index"]}\` but has no \`position:\` declaration ` +
          "(or is `position: static`). `z-index` is a no-op on statically-positioned elements — your " +
          "stacking order will fall back to DOM order.",
        selector,
        fixHint: "Add `position: relative;` (or `absolute`/`fixed` as the layout requires).",
      });
    }

    // Inline pass.
    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const inline = parseInlineStyle(readAttr(tag.raw, "style"));
      if (!inline["z-index"]) continue;
      if (inline["z-index"].trim().toLowerCase() === "auto") continue;
      const pos = (inline.position || "static").toLowerCase();
      if (pos !== "static") continue;
      // FP fix: if any CSS rule whose selector matches this tag declares a
      // non-static `position`, the inline z-index is effective.
      if (tagHasSiblingPosition(tag)) continue;
      const selector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
      if (reported.has(selector)) continue;
      reported.add(selector);
      findings.push({
        code: "z_index_without_position",
        severity: "warning",
        message:
          `\`${selector}\` (inline style) sets \`z-index: ${inline["z-index"]}\` without a non-static ` +
          "`position:`. `z-index` is a no-op on statically-positioned elements.",
        selector,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint: "Add `position: relative;` to the inline style (or `absolute`/`fixed`).",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 12. gap_on_absolute_children_container ──────────────────────────────
  // `gap` only applies to in-flow flex/grid children. If every direct child
  // is `position: absolute`, the `gap` declaration has no effect.
  ({ source, tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);
    const reported = new Set<string>();

    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const decls = lookupDeclsForTag(tag, declMap);
      const display = (decls.display || "").toLowerCase();
      const isFlexOrGrid = ["flex", "grid", "inline-flex", "inline-grid"].includes(display);
      if (!isFlexOrGrid) continue;
      const hasGap = decls.gap || decls["row-gap"] || decls["column-gap"];
      if (!hasGap) continue;

      const children = directChildTags(source, tags, tag);
      if (children.length === 0) continue;
      const allAbsolute = children.every((c) => hasPositionAbsolute(lookupDeclsForTag(c, declMap)));
      if (!allAbsolute) continue;

      const selector = tagSelectorKeys(tag)[0] ?? `<${tag.name}>`;
      if (reported.has(selector)) continue;
      reported.add(selector);
      findings.push({
        code: "gap_on_absolute_children_container",
        severity: "warning",
        message:
          `\`${selector}\` uses \`gap: ${decls.gap || decls["row-gap"] || decls["column-gap"]}\` but every ` +
          "direct child has `position: absolute` — `gap` only applies to in-flow flex/grid children, " +
          "so it has no effect here.",
        selector,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint:
          "Either remove `position: absolute` from the children (let flex handle layout), or remove `gap:` " +
          "and write explicit offsets per child.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 13. tl_from_opacity_no_initial_set ──────────────────────────────────
  // `tl.from({ opacity: 0 })` has a one-frame FOUC window before the
  // timeline wires up. Aggregate threshold: warn when 3+ such tweens exist
  // and there's no defensive `gsap.set` covering them OR no CSS
  // hidden-default rule whose selector actually matches a fade target.
  // The matching-selector check prevents an unrelated `.debug-overlay
  // { opacity:0 }` from silencing the rule.
  ({ scripts, styles, source, tags }) => {
    const findings: HyperframeLintFinding[] = [];

    // Capture both the from() call AND extract the target selector(s) it
    // animates. The first arg may be:
    //   - a quoted string: '.hero' or '#cta'
    //   - an array literal: ['.hero', '.subtitle']
    //   - a variable / DOM ref — we treat these as "unknown" targets and
    //     conservatively count them but cannot match them against CSS.
    const fromTargets: string[] = [];
    const setTargets: string[] = [];
    let unknownFromCount = 0;

    const parseFirstArg = (raw: string): string[] | null => {
      const trimmed = raw.trim();
      // Quoted string.
      const quoted = trimmed.match(/^["']([^"']+)["']/);
      if (quoted) return [quoted[1]!];
      // Array literal: collect every quoted string inside.
      const arr = trimmed.match(/^\[([\s\S]*?)\]/);
      if (arr) {
        const items: string[] = [];
        const itemRe = /["']([^"']+)["']/g;
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(arr[1]!)) !== null) items.push(m[1]!);
        return items.length > 0 ? items : null;
      }
      return null;
    };

    // Walk each tl.from / gsap.from call and pull its first arg.
    const fromCallRe =
      /\b(?:tl|timeline|gsap)\.from\s*\(\s*([\s\S]*?)\s*,\s*(\{[^}]*opacity\s*:\s*0\b[^}]*\})/g;
    const setCallRe =
      /\bgsap\.set\s*\(\s*([\s\S]*?)\s*,\s*(\{[^}]*(?:opacity\s*:\s*0|autoAlpha\s*:\s*0|visibility\s*:\s*["']hidden["'])[^}]*\})/g;

    let fromCount = 0;
    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      let m: RegExpExecArray | null;
      fromCallRe.lastIndex = 0;
      while ((m = fromCallRe.exec(cleaned)) !== null) {
        fromCount += 1;
        const args = parseFirstArg(m[1] || "");
        if (args) fromTargets.push(...args);
        else unknownFromCount += 1;
      }
      setCallRe.lastIndex = 0;
      while ((m = setCallRe.exec(cleaned)) !== null) {
        const args = parseFirstArg(m[1] || "");
        if (args) setTargets.push(...args);
        else setTargets.push("__unknown__"); // counts as coverage
      }
    }

    if (fromCount < 3) return findings;

    // Coverage check: every fade target must be covered by EITHER a
    // matching gsap.set or a matching CSS hidden-default rule. An unknown
    // gsap.set target counts as coverage for everything (conservative).
    const setCoversAll = setTargets.includes("__unknown__");

    // Collect CSS hidden-default rules: selector -> true if it sets
    // opacity:0 or visibility:hidden.
    const hiddenCssSelectors: string[] = [];
    for (const style of styles) {
      let root: postcss.Root;
      try {
        root = postcss.parse(style.content);
      } catch {
        continue;
      }
      root.walkRules((rule) => {
        let hides = false;
        for (const node of rule.nodes ?? []) {
          if (node.type !== "decl") continue;
          const prop = node.prop.toLowerCase();
          const value = node.value.trim().toLowerCase();
          if (prop === "opacity" && /^0(?:\.0+)?$/.test(value)) hides = true;
          if (prop === "visibility" && value === "hidden") hides = true;
        }
        if (!hides) return;
        for (const sel of rule.selectors ?? []) hiddenCssSelectors.push(sel.trim());
      });
    }

    const isCoveredBySet = (target: string): boolean => {
      if (setCoversAll) return true;
      return setTargets.includes(target);
    };
    const isCoveredByCss = (target: string): boolean => {
      for (const sel of hiddenCssSelectors) {
        if (cssSelectorCoversTarget(source, tags, sel, target)) return true;
      }
      return false;
    };

    // Compute uncovered fades (only over known targets — unknowns can't be
    // matched against CSS, but the rule is about defensive setup so unknown
    // calls aren't punished by themselves).
    const uncovered = fromTargets.filter((t) => !isCoveredBySet(t) && !isCoveredByCss(t));

    // Fire if:
    //  - there's no global gsap.set fallback, AND
    //  - we have 3+ uncovered known fades (the canonical FOUC risk), OR
    //  - we have unknown-target fades and ALSO no CSS hidden rule (zero coverage).
    const noCssCoverage = hiddenCssSelectors.length === 0;
    const shouldFire =
      (uncovered.length >= 3 && !setCoversAll) ||
      (fromTargets.length === 0 &&
        unknownFromCount >= 3 &&
        noCssCoverage &&
        setTargets.length === 0);

    if (shouldFire) {
      findings.push({
        code: "tl_from_opacity_no_initial_set",
        severity: "warning",
        message:
          `Composition has ${fromCount} \`tl.from({ opacity: 0 })\` calls but no defensive ` +
          "`gsap.set({ opacity: 0 })` or CSS hidden default covering the fade targets. Between page-ready " +
          "and timeline-wiring there is a one-frame window where elements render at full opacity — image " +
          "decode or FOUT can flash visible content for a frame.",
        fixHint:
          "Add `gsap.set(['.hero', '.subtitle', '.cta'], { opacity: 0 });` at the top of your script, " +
          "or `visibility: hidden` in CSS on the entrance targets.",
      });
    }
    return findings;
  },

  // ── 14. img_missing_dimensions ──────────────────────────────────────────
  // Aggregate finding: 5+ <img> tags without width/height attrs.
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    let count = 0;
    for (const tag of tags) {
      if (tag.name !== "img") continue;
      const hasWidth = readAttr(tag.raw, "width") !== null;
      const hasHeight = readAttr(tag.raw, "height") !== null;
      if (hasWidth && hasHeight) continue;
      const inline = parseInlineStyle(readAttr(tag.raw, "style"));
      if (inline.width && inline.height) continue;
      count += 1;
    }
    if (count >= 5) {
      findings.push({
        code: "img_missing_dimensions",
        severity: "warning",
        message:
          `Composition has ${count} \`<img>\` tags without explicit \`width\`/\`height\` attributes. ` +
          "Each contributes a layout shift after image decode in headless capture.",
        fixHint:
          'Add `width="..." height="..."` attributes to every `<img>` — even decorative images. ' +
          "Bonus: set the attributes in px to match the rendered size so the browser can reserve space pre-decode.",
      });
    }
    return findings;
  },

  // ── 15. overflow_hidden_clips_scaled_target ─────────────────────────────
  // `overflow: hidden` ancestor + GSAP scale > 1 descendant silently clips
  // the scaled bounding box.
  //
  // FP fixes:
  //  A. Multiple `overflow: hidden` ancestors of the same scaled descendant
  //     used to triple-fire — we now dedupe to the INNERMOST ancestor (the
  //     effective clipping surface) per (descendant, target) pair.
  //  B. Full-bleed Ken Burns backgrounds are an intentional clip. Suppress
  //     when the scaled target is `position: absolute; inset: 0` (or all four
  //     top/right/bottom/left = 0) AND `object-fit: cover` AND scale peak ≤
  //     1.2× — that's a classic Ken Burns, not a layout bug.
  //  C. Scaled-bbox vs host check. Compute the target's base width/height
  //     (CSS px or `width=`/`height=` attribute) and multiply by the peak
  //     scale. If the resulting bbox fits comfortably inside the 1920x1080
  //     host (≤ 95% on both axes), the "clip" is purely theoretical — small
  //     icons and radial-glow decorations never reach the host edge at
  //     1.05× / 1.1× / 1.2× scale.
  //  D. Tiny-target suppression. If the base area is < 30% of the host area,
  //     the target is decorative-sized and almost never produces a visible
  //     clip (Netflix analysis: 10/10 FPs were 60-200px glows/logos inside
  //     a 1920x1080 root).
  //  E. Indeterminate-size fallback. When CSS width/height can't be
  //     determined, gate purely on scale: peak ≤ 1.15× is almost never a
  //     real clip on a target of unknown size.
  ({ source, tags, styles, scripts, rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    if (!scripts.some((s) => /gsap\.(to|from|fromTo|set|timeline)/.test(s.content)))
      return findings;

    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);

    // ── Host dimensions for bbox math (FP C/D). Default to 1920x1080 if
    // the composition root doesn't carry data-width/data-height. ──────────
    const hostWidth = Number(readAttr(rootTag?.raw || "", "data-width")) || 1920;
    const hostHeight = Number(readAttr(rootTag?.raw || "", "data-height")) || 1080;
    const hostArea = hostWidth * hostHeight;

    // Parse a CSS length like "60px" or "30%" into an absolute px value
    // against the supplied container axis. Returns NaN when the value can't
    // be resolved (e.g. `auto`, `calc(...)`, viewport units).
    const parseCssPx = (value: string | undefined, axis: number): number => {
      if (!value) return Number.NaN;
      const trimmed = value.trim();
      const pxMatch = /^(-?\d+(?:\.\d+)?)\s*px$/i.exec(trimmed);
      if (pxMatch) return Number(pxMatch[1]);
      const pctMatch = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
      if (pctMatch) return (Number(pctMatch[1]) / 100) * axis;
      const bare = /^(-?\d+(?:\.\d+)?)$/.exec(trimmed);
      if (bare) return Number(bare[1]);
      return Number.NaN;
    };

    // Best-effort base width/height for the scaled descendant. Tries (in
    // priority order): CSS width/height decls, `width=`/`height=` HTML
    // attributes (img/svg/canvas), `inset: 0` (= host-sized). Returns NaN
    // axes when we can't determine.
    const inferBaseSize = (tag: OpenTag): { w: number; h: number } => {
      const decls = lookupDeclsForTag(tag, declMap);
      let w = parseCssPx(decls.width, hostWidth);
      let h = parseCssPx(decls.height, hostHeight);
      if (!Number.isFinite(w)) {
        const attrW = readAttr(tag.raw, "width");
        if (attrW) w = parseCssPx(attrW, hostWidth);
      }
      if (!Number.isFinite(h)) {
        const attrH = readAttr(tag.raw, "height");
        if (attrH) h = parseCssPx(attrH, hostHeight);
      }
      // inset:0 (or all four sides = 0) implies host-sized box.
      const inset = (decls.inset || "").trim();
      const insetIsZero = /^0(?:\s*0){0,3}\s*(?:px)?$/.test(inset) || inset === "0";
      const zeroOffset = (v: string | undefined) =>
        v != null && /^\s*0(?:px|%)?\s*$/.test(v.toLowerCase());
      const fourSides =
        zeroOffset(decls.top) &&
        zeroOffset(decls.right) &&
        zeroOffset(decls.bottom) &&
        zeroOffset(decls.left);
      if (insetIsZero || fourSides) {
        if (!Number.isFinite(w)) w = hostWidth;
        if (!Number.isFinite(h)) h = hostHeight;
      }
      return { w, h };
    };

    // Collect GSAP scale targets with scale > 1. Strip comments only — we
    // need the quoted selector string intact to match the target.
    type ScaleTarget = { selector: string; scale: number; raw: string };
    const scaleTargets: ScaleTarget[] = [];
    const scaleRe =
      /\.(?:to|from|fromTo|set)\s*\(\s*["']([^"']+)["']\s*,\s*\{[^}]*scale\s*:\s*([0-9.]+)/g;
    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      let m: RegExpExecArray | null;
      scaleRe.lastIndex = 0;
      while ((m = scaleRe.exec(cleaned)) !== null) {
        const sel = m[1] || "";
        const scale = Number(m[2]);
        if (Number.isFinite(scale) && scale > 1) {
          scaleTargets.push({ selector: sel, scale, raw: m[0] });
        }
      }
    }
    if (scaleTargets.length === 0) return findings;

    // ── FP B helper: full-bleed Ken Burns detection ─────────────────────
    // Recognises an intentional clip-and-pan background: the scaled target
    // covers its immediate clipping ancestor (`position: absolute` with
    // `inset: 0` or all four offsets = 0) AND uses `object-fit: cover` AND
    // the scale peak is gentle (≤ 1.2×). At those parameters the clipping
    // IS the Ken Burns effect, not a bug.
    const isFullBleedKenBurns = (descendant: OpenTag, scale: number): boolean => {
      if (scale > 1.2) return false;
      const dDecls = lookupDeclsForTag(descendant, declMap);
      if ((dDecls.position || "").toLowerCase() !== "absolute") return false;
      const inset = (dDecls.inset || "").trim();
      const insetIsZero = /^0(?:\s*0){0,3}\s*(?:px)?$/.test(inset) || inset === "0";
      const zeroOffset = (v: string | undefined) =>
        v != null && /^\s*0(?:px|%)?\s*$/.test(v.toLowerCase());
      const fourSides =
        zeroOffset(dDecls.top) &&
        zeroOffset(dDecls.right) &&
        zeroOffset(dDecls.bottom) &&
        zeroOffset(dDecls.left);
      if (!insetIsZero && !fourSides) return false;
      if ((dDecls["object-fit"] || "").toLowerCase() !== "cover") return false;
      return true;
    };

    // First pass: gather every (innermost-ancestor, descendant, target)
    // triple so we can dedupe outer wrappers per (descendant, target).
    type Candidate = {
      ancestor: OpenTag;
      descendant: OpenTag;
      target: ScaleTarget;
    };
    const candidates: Candidate[] = [];

    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const decls = lookupDeclsForTag(tag, declMap);
      if ((decls.overflow || "").toLowerCase() !== "hidden") continue;

      const start = tag.index;
      const end = findTagEndIndex(source, tag);

      for (const descendant of tags) {
        if (descendant === tag) continue;
        if (descendant.index < start || descendant.index >= end) continue;
        for (const target of scaleTargets) {
          let matches = false;
          if (tagSelectorKeys(descendant).includes(target.selector)) {
            matches = true;
          } else if (selectorMatchesTag(source, tags, target.selector, descendant)) {
            matches = true;
          }
          if (!matches) continue;
          candidates.push({ ancestor: tag, descendant, target });
        }
      }
    }

    // FP A: dedupe to INNERMOST ancestor per (descendant, target). When the
    // same descendant has multiple overflow-hidden wrappers, only the
    // closest one (highest `index`, since ancestors must open before their
    // descendants in source order) is the effective clipping surface.
    const innermost = new Map<string, Candidate>();
    for (const cand of candidates) {
      const key = `${cand.descendant.index}|${cand.target.selector}|${cand.target.scale}`;
      const prev = innermost.get(key);
      if (!prev || cand.ancestor.index > prev.ancestor.index) {
        innermost.set(key, cand);
      }
    }

    const reported = new Set<string>();
    for (const cand of innermost.values()) {
      // FP B: skip full-bleed Ken Burns backgrounds.
      if (isFullBleedKenBurns(cand.descendant, cand.target.scale)) continue;

      // ── FP C/D/E: scaled-bbox vs host check. ─────────────────────────
      // The original rule fired whenever overflow:hidden + scale>1 coexisted,
      // regardless of whether the scaled box could actually reach the host
      // edge. On a 1920x1080 root, a 60px icon at 1.1× scale is 66px — never
      // a real clip. Netflix run: 10/10 firings were this shape.
      const scale = cand.target.scale;
      const { w: baseW, h: baseH } = inferBaseSize(cand.descendant);
      const haveSize = Number.isFinite(baseW) && Number.isFinite(baseH);

      if (haveSize) {
        const baseArea = baseW * baseH;
        // FP D: tiny decorative target — base area < 30% of host area.
        if (baseArea > 0 && baseArea < hostArea * 0.3) continue;

        // FP C: scaled bbox stays inside the host (≤ 95% on both axes).
        const scaledW = baseW * scale;
        const scaledH = baseH * scale;
        if (scaledW <= hostWidth * 0.95 && scaledH <= hostHeight * 0.95) continue;
      } else {
        // FP E: indeterminate size + small scale → almost never a real clip.
        if (scale <= 1.15) continue;
      }

      const ancestorSelector = tagSelectorKeys(cand.ancestor)[0] ?? `<${cand.ancestor.name}>`;
      const target = cand.target;
      const key = `${ancestorSelector}|${target.selector}|${target.scale}`;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push({
        code: "overflow_hidden_clips_scaled_target",
        severity: "warning",
        message:
          `\`${ancestorSelector}\` has \`overflow: hidden\` and contains descendant ` +
          `\`${target.selector}\` which GSAP scales to ${target.scale}× — the scaled bounding ` +
          "box will clip silently.",
        selector: target.selector,
        fixHint:
          `Either set \`overflow: visible\` on \`${ancestorSelector}\`, or shrink the target's ` +
          `base size so its peak-scale bounding box fits inside \`${ancestorSelector}\`.`,
        snippet: truncateSnippet(target.raw),
      });
    }
    return findings;
  },

  // ── 16. open_close_frame_visibility ─────────────────────────────────────
  // Frame-00 and frame-(end) are the two most-seen frames of any render.
  // If every fade-in target is hidden via CSS `opacity: 0` / `visibility:
  // hidden` or `gsap.set({ opacity: 0 })` AND the earliest reveal happens
  // after master t=0.1s AND nothing else is visible at t=0 (no opacity:1
  // element, no opaque body/html background), the opening reads as a
  // black/broken first frame. Same for the end: if every revealed element
  // animates back to opacity:0 at or before duration with no surviving
  // visible layer, the closing reads as a black bookend.
  //
  // FP guards:
  //   - root index.html only (sub-comps may rely on parent backgrounds)
  //   - any opaque body/html/* background suppresses the rule entirely
  //   - any single element with no hidden default AND no fade-out-at-end
  //     tween counts as "visible at t=0" / "visible at duration"
  //   - end check requires a finite `data-duration` on the root tag
  ({ source, scripts, styles, tags, rootTag, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;
    if (!rootTag) return findings;
    const durationAttr = readAttr(rootTag.raw, "data-duration");
    const duration = durationAttr ? Number(durationAttr) : NaN;

    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);

    // ── 1. Catalog every visible element at t=0 by CSS resolution. ──────
    // Any tag NOT hidden via opacity/visibility CSS counts toward
    // "visible at frame-00" unless it's later proven to be hidden via
    // gsap.set. Background opacity on body/html also counts.
    let visibleBackgroundFound = false;
    const cssHiddenTags = new Set<OpenTag>();
    const allEligibleTags: OpenTag[] = [];
    for (const tag of tags) {
      if (
        [
          "script",
          "style",
          "link",
          "meta",
          "template",
          "noscript",
          "head",
          "title",
          "html",
        ].includes(tag.name)
      )
        continue;
      allEligibleTags.push(tag);
      const decls = lookupDeclsForTag(tag, declMap);
      const opacity = (decls.opacity || "").trim();
      const visibility = (decls.visibility || "").trim().toLowerCase();
      const cssHidden = /^0(?:\.0+)?$/.test(opacity) || visibility === "hidden";
      if (cssHidden) cssHiddenTags.add(tag);
      // Body / opaque background scan (handles inline style on <body>).
      if (tag.name === "body") {
        const bg = (decls["background"] || decls["background-color"] || "").toLowerCase();
        const bgImage = (decls["background-image"] || "").toLowerCase();
        const hasOpaqueBg =
          (bg && bg !== "transparent" && bg !== "none" && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) ||
          (bgImage && bgImage !== "none");
        if (hasOpaqueBg) visibleBackgroundFound = true;
      }
    }
    // body / html / * background via CSS rules.
    for (const [selector, decls] of declMap) {
      if (!/(?:^|\s|,)\s*(?:body|html|\*)\b/.test(selector)) continue;
      const bg = (decls["background"] || decls["background-color"] || "").toLowerCase();
      const bgImage = (decls["background-image"] || "").toLowerCase();
      const hasOpaqueBg =
        (bg && bg !== "transparent" && bg !== "none" && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) ||
        (bgImage && bgImage !== "none");
      if (hasOpaqueBg) visibleBackgroundFound = true;
    }

    // ── 2. Scan GSAP scripts: gsap.set hidden targets + opacity tweens. ─
    const setHiddenSelectors: string[] = [];
    type OpacityTween = {
      selector: string;
      toOpacity: number;
      position: number;
      isFrom: boolean;
    };
    const opacityTweens: OpacityTween[] = [];

    const parseFirstArgSelectors = (raw: string): string[] => {
      const trimmed = raw.trim();
      const quoted = trimmed.match(/^["']([^"']+)["']/);
      if (quoted) return [quoted[1]!];
      const arr = trimmed.match(/^\[([\s\S]*?)\]/);
      if (arr) {
        const items: string[] = [];
        const itemRe = /["']([^"']+)["']/g;
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(arr[1]!)) !== null) items.push(m[1]!);
        return items;
      }
      return [];
    };

    const setHidesRe =
      /opacity\s*:\s*0(?:\b|\s|,|})|autoAlpha\s*:\s*0(?:\b|\s|,|})|visibility\s*:\s*["']hidden["']/;
    const setCallRe = /\bgsap\.set\s*\(\s*([\s\S]*?)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    const tweenCallRe =
      /\b(?:tl|timeline|gsap)\.(to|from|fromTo)\s*\(\s*([\s\S]*?)\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*(\{[\s\S]*?\}))?(?:\s*,\s*([0-9.]+))?\s*\)/g;

    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      setCallRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = setCallRe.exec(cleaned)) !== null) {
        const propsBlob = m[2] || "";
        if (!setHidesRe.test(propsBlob)) continue;
        for (const sel of parseFirstArgSelectors(m[1] || "")) setHiddenSelectors.push(sel);
      }

      tweenCallRe.lastIndex = 0;
      while ((m = tweenCallRe.exec(cleaned)) !== null) {
        const method = m[1] || "";
        const sels = parseFirstArgSelectors(m[2] || "");
        if (sels.length === 0) continue;
        const propsBlob = m[3] || "";
        const opacityMatch = /opacity\s*:\s*([0-9.]+)/.exec(propsBlob);
        if (!opacityMatch) continue;
        const value = Number(opacityMatch[1]);
        if (!Number.isFinite(value)) continue;
        const pos = m[5] ? Number(m[5]) : 0;
        for (const sel of sels) {
          opacityTweens.push({
            selector: sel,
            toOpacity: value,
            position: Number.isFinite(pos) ? pos : 0,
            isFrom: method === "from",
          });
        }
      }
    }

    // ── 3. Determine "anything visible at frame-00". A tag counts as
    // visible only if (a) it isn't CSS-hidden, (b) no gsap.set hides it,
    // AND (c) it has visible content — text, an image/video/canvas/svg
    // payload, OR a non-transparent background. Plain structural wrappers
    // (composition hosts, empty section shells) don't count; otherwise
    // the rule never fires.
    const setHiddenSet = new Set(setHiddenSelectors);
    const VISIBLE_CONTENT_TAGS = new Set(["img", "video", "canvas", "svg", "picture", "iframe"]);
    const hasInlineText = (tag: OpenTag): boolean => {
      const openEnd = tag.index + tag.raw.length;
      const nextLt = source.indexOf("<", openEnd);
      const slice = nextLt === -1 ? source.slice(openEnd) : source.slice(openEnd, nextLt);
      return slice.replace(/&nbsp;/g, " ").trim().length > 0;
    };
    const hasOpaqueBgDecl = (decls: DeclMap): boolean => {
      const bg = (decls["background"] || decls["background-color"] || "").toLowerCase();
      const bgImage = (decls["background-image"] || "").toLowerCase();
      return (
        Boolean(bg && bg !== "transparent" && bg !== "none" && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) ||
        Boolean(bgImage && bgImage !== "none")
      );
    };
    let anyVisibleAtStart = visibleBackgroundFound;
    if (!anyVisibleAtStart) {
      for (const tag of allEligibleTags) {
        if (cssHiddenTags.has(tag)) continue;
        const keys = tagSelectorKeys(tag);
        const hiddenBySet = keys.some((k) => setHiddenSet.has(k));
        if (hiddenBySet) continue;
        if (readAttr(tag.raw, "data-composition-id") || readAttr(tag.raw, "data-composition-src"))
          continue;
        const decls = lookupDeclsForTag(tag, declMap);
        const isContentTag = VISIBLE_CONTENT_TAGS.has(tag.name);
        if (isContentTag || hasOpaqueBgDecl(decls) || hasInlineText(tag)) {
          anyVisibleAtStart = true;
          break;
        }
      }
    }

    // No hidden machinery at all? Nothing to warn about.
    const anyHiddenMachinery = cssHiddenTags.size > 0 || setHiddenSelectors.length > 0;
    if (!anyHiddenMachinery) return findings;

    // ── 4. Opening frame check ─────────────────────────────────────────
    let earliestReveal = Number.POSITIVE_INFINITY;
    for (const t of opacityTweens) {
      const reveals = t.isFrom ? t.toOpacity === 0 : t.toOpacity > 0;
      if (!reveals) continue;
      if (t.position < earliestReveal) earliestReveal = t.position;
    }
    if (!anyVisibleAtStart && Number.isFinite(earliestReveal) && earliestReveal > 0.1) {
      findings.push({
        code: "open_close_frame_visibility",
        severity: "warning",
        message:
          `First frame has no visible elements: every entrance target is hidden at t=0 and the ` +
          `earliest opacity reveal is master t=${earliestReveal.toFixed(2)}s (>100ms past frame-00). ` +
          "Frame-00 is one of the two most-seen frames of any render — a black bookend reads as broken.",
        fixHint:
          "Ensure at least one element (background, logo, gradient) is at opacity=1 at master t=0 " +
          "AND at master t=duration. Drop the hidden default on a base layer, add a persistent " +
          "background, or move the first reveal to t=0.",
      });
    }

    // ── 5. Closing frame check ─────────────────────────────────────────
    if (Number.isFinite(duration) && duration > 0) {
      // For every selector that ever gets revealed, find its LAST opacity
      // event. If that last event is to:0 at/before duration, it's dark at
      // duration. If any revealed selector stays at opacity > 0, we're fine.
      const revealedSelectors = new Set<string>();
      for (const t of opacityTweens) {
        const reveals = t.isFrom ? t.toOpacity === 0 : t.toOpacity > 0;
        if (reveals) revealedSelectors.add(t.selector);
      }
      const lastByTarget = new Map<string, { toOpacity: number; position: number }>();
      for (const t of opacityTweens) {
        const prev = lastByTarget.get(t.selector);
        if (!prev || t.position >= prev.position) {
          lastByTarget.set(t.selector, { toOpacity: t.toOpacity, position: t.position });
        }
      }
      let anyVisibleAtEnd = visibleBackgroundFound;
      // Tags that are visible at t=0 and never get a fade-out tween also
      // remain visible at the end. Apply the same content-vs-wrapper
      // filter as the opening-frame check.
      if (!anyVisibleAtEnd) {
        for (const tag of allEligibleTags) {
          if (cssHiddenTags.has(tag)) continue;
          const keys = tagSelectorKeys(tag);
          if (keys.some((k) => setHiddenSet.has(k))) continue;
          if (readAttr(tag.raw, "data-composition-id") || readAttr(tag.raw, "data-composition-src"))
            continue;
          const decls = lookupDeclsForTag(tag, declMap);
          const isContentTag = VISIBLE_CONTENT_TAGS.has(tag.name);
          const visible = isContentTag || hasOpaqueBgDecl(decls) || hasInlineText(tag);
          if (!visible) continue;
          const last = keys
            .map((k) => lastByTarget.get(k))
            .find((x): x is { toOpacity: number; position: number } => Boolean(x));
          if (!last) {
            anyVisibleAtEnd = true;
            break;
          }
          if (!(last.toOpacity === 0 && last.position <= duration + 0.01)) {
            anyVisibleAtEnd = true;
            break;
          }
        }
      }
      if (!anyVisibleAtEnd) {
        for (const sel of revealedSelectors) {
          const last = lastByTarget.get(sel);
          if (!last) continue;
          if (!(last.toOpacity === 0 && last.position <= duration + 0.01)) {
            anyVisibleAtEnd = true;
            break;
          }
        }
      }
      if (!anyVisibleAtEnd && revealedSelectors.size > 0) {
        findings.push({
          code: "open_close_frame_visibility",
          severity: "warning",
          message:
            `Last frame has no visible elements: every revealed element fades to opacity:0 at or ` +
            `before master t=${duration}s. Frame-(end) is one of the two most-seen frames of any ` +
            "render — a black bookend reads as broken.",
          fixHint:
            "Ensure at least one element (background, logo, end-card, gradient) is at opacity=1 at " +
            "master t=duration. Hold a base layer at opacity:1, or land a hero element on the final " +
            "frame and let it persist.",
        });
      }
    }

    return findings;
  },

  // ── 17. stat_counter_zero_state_window ──────────────────────────────────
  // GSAP "counter" pattern: an element shows `0` / `0%` / `$0` literal in
  // its initial text content, then a tween animates a proxy `{ value: 0 }`
  // (or counts directly on the element) with an `onUpdate` writing the
  // value back to `textContent` / `innerText`. If two or more such
  // counters cascade with DIFFERENT start times within the same beat,
  // there is a window where one counter shows its target while another
  // still reads `0` — a stat row captured during that window looks broken
  // ("$1.9T / 0% / 0+"). Sync the starts or set initial text to the final
  // value and reveal via opacity-only.
  ({ scripts, tags, source }) => {
    const findings: HyperframeLintFinding[] = [];
    if (scripts.length === 0) return findings;

    // 1. Find tags whose immediate inner text starts with a zero literal.
    //    We slice the source between each tag's open-end and the next
    //    `<` to capture leading text content.
    const zeroLiteralRe = /^\s*[$£€¥]?\s*0(?:[.,]0+)?\s*(?:%|\+|K|M|B|T)?\s*$/i;
    type ZeroTag = { tag: OpenTag; selectorKeys: string[] };
    const zeroTags: ZeroTag[] = [];
    for (const tag of tags) {
      if (
        [
          "script",
          "style",
          "link",
          "meta",
          "template",
          "noscript",
          "head",
          "title",
          "html",
          "body",
        ].includes(tag.name)
      )
        continue;
      const openEnd = tag.index + tag.raw.length;
      const nextLt = source.indexOf("<", openEnd);
      const text = (nextLt === -1 ? source.slice(openEnd) : source.slice(openEnd, nextLt))
        .replace(/&nbsp;/g, " ")
        .trim();
      if (!text) continue;
      if (!zeroLiteralRe.test(text)) continue;
      const keys = tagSelectorKeys(tag);
      if (keys.length === 0) continue;
      zeroTags.push({ tag, selectorKeys: keys });
    }
    if (zeroTags.length < 2) return findings;

    // 2. For each zero-tag, find a GSAP counter tween that targets it.
    //    Counter pattern detection:
    //      - A tween whose target string matches one of the zero-tag's
    //        selector keys (`.stat-1`, `#count`, etc.) AND whose props
    //        blob mentions `innerText`, `textContent`, or a recognizable
    //        counter proxy (`{ value: N }` with an `onUpdate`).
    //      - OR a tween on a proxy variable with an `onUpdate` writing
    //        back to a DOM element selected via `querySelector('<key>')`.
    type CounterHit = { selectorKey: string; position: number; raw: string };
    const counterHits: CounterHit[] = [];

    // Pattern A: direct selector-targeted tween with text-counter props.
    const directRe =
      /\b(?:tl|timeline|gsap)\.(?:to|from|fromTo)\s*\(\s*["']([^"']+)["']\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*(\{[\s\S]*?\}))?(?:\s*,\s*([0-9.]+))?\s*\)/g;

    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      directRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = directRe.exec(cleaned)) !== null) {
        const selector = m[1] || "";
        const props1 = m[2] || "";
        const props2 = m[3] || "";
        const blob = `${props1}\n${props2}`;
        const isCounter =
          /\binnerText\s*[:=]/.test(blob) ||
          /\btextContent\s*[:=]/.test(blob) ||
          (/onUpdate\s*:/.test(blob) && /\bvalue\s*:/.test(blob));
        if (!isCounter) continue;
        const pos = m[4] ? Number(m[4]) : 0;
        // Match selector against zero-tag selector keys.
        for (const zt of zeroTags) {
          if (!zt.selectorKeys.includes(selector)) continue;
          counterHits.push({
            selectorKey: selector,
            position: Number.isFinite(pos) ? pos : 0,
            raw: m[0],
          });
        }
      }

      // Pattern B: proxy tween + onUpdate writing to a selector. We look
      // for a tween whose first arg is an object literal containing
      // `value: 0` AND whose second props blob has a `querySelector(...)`
      // / `document.getElementById(...)` referencing a zero-tag.
      const proxyRe =
        /\b(?:tl|timeline|gsap)\.(?:to|from|fromTo)\s*\(\s*(\{[\s\S]*?value\s*:\s*0[\s\S]*?\})\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*([0-9.]+))?\s*\)/g;
      proxyRe.lastIndex = 0;
      while ((m = proxyRe.exec(cleaned)) !== null) {
        const propsBlob = m[2] || "";
        const pos = m[3] ? Number(m[3]) : 0;
        // Find which zero-tag this proxy targets, if any.
        for (const zt of zeroTags) {
          const id = readAttr(zt.tag.raw, "id");
          let referenced = false;
          if (id) {
            const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (
              new RegExp(`getElementById\\s*\\(\\s*["']${esc}["']`).test(propsBlob) ||
              new RegExp(`querySelector\\s*\\(\\s*["']#${esc}["']`).test(propsBlob)
            )
              referenced = true;
          }
          if (!referenced) {
            for (const key of zt.selectorKeys) {
              const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              if (new RegExp(`querySelector(?:All)?\\s*\\(\\s*["']${esc}["']`).test(propsBlob)) {
                referenced = true;
                break;
              }
            }
          }
          if (!referenced) continue;
          counterHits.push({
            selectorKey: zt.selectorKeys[0]!,
            position: Number.isFinite(pos) ? pos : 0,
            raw: m[0],
          });
        }
      }
    }

    if (counterHits.length < 2) return findings;

    // 3. Detect cascade: 2+ counters with DIFFERENT start positions.
    const distinctPositions = new Set(counterHits.map((c) => c.position.toFixed(3)));
    if (distinctPositions.size < 2) return findings;

    const targetList = [...new Set(counterHits.map((c) => c.selectorKey))].slice(0, 4).join(", ");
    findings.push({
      code: "stat_counter_zero_state_window",
      severity: "warning",
      message:
        `Multiple stat counters (${targetList}) cascade with staggered start times ` +
        `(${[...distinctPositions].sort().join("s, ")}s). There is a window where one counter ` +
        "already shows its target value while another still reads its zero literal (`0`, `0%`, " +
        "`$0`) — frames captured during this window display broken stat data (e.g. `$1.9T / 0% / 0+`).",
      fixHint:
        "Sync all counter starts to the same anchor time (`tl.add(label, t)` then start each " +
        "counter at `label`), OR set the initial textContent to the final value and reveal via " +
        "opacity-only.",
      snippet: truncateSnippet(counterHits[0]!.raw),
    });

    return findings;
  },

  // ── 18. id_selector_on_data_composition_wrapper ─────────────────────────
  // Observed in BOTH Porsche runs (and recurring on raycast) this batch:
  // the composition wrapper carries ONLY `data-composition-id="beat-1-heritage"`
  // with NO matching `id="beat-1-heritage"` attribute, yet the file's CSS
  // uses `#beat-1-heritage { display: flex; ... }`. The ID selector matches
  // nothing, the rule silently drops, and the split-screen hero collapses
  // off-screen. This rule catches the mismatch by walking every bare ID
  // selector in the CSS and checking whether the only element bearing that
  // identifier carries it as `data-composition-id` instead of `id`.
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const reported = new Set<string>();

    // Build a lookup of (id-value-without-hash) → tag carrying that value as
    // `data-composition-id`. Also build the set of REAL `id="..."` attributes
    // so we can confirm the negative.
    //
    // NOTE: `readAttr` uses a `\b` word-boundary anchor, which would match
    // `id="..."` inside `data-composition-id="..."` (the `-` before `id` is
    // a word boundary). We instead require whitespace OR start-of-tag before
    // `id=`, so `data-composition-id` doesn't falsely register as a real
    // `id` attribute and silence the rule.
    const REAL_ID_ATTR = /(?:^|\s)id\s*=\s*["']([^"']+)["']/i;
    const dataCompIdMap = new Map<string, OpenTag>();
    const realIdSet = new Set<string>();
    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const realIdMatch = tag.raw.match(REAL_ID_ATTR);
      if (realIdMatch) realIdSet.add(realIdMatch[1]!);
      const dataId = readAttr(tag.raw, "data-composition-id");
      if (dataId && !dataCompIdMap.has(dataId)) dataCompIdMap.set(dataId, tag);
    }
    if (dataCompIdMap.size === 0) return findings;

    // Extract every bare-ID selector — either standalone (`#id`) or as the
    // host of a descendant combinator (`#id .foo`, `#id *`, `#id > .bar`).
    // We accept any selector token that starts with `#<ident>` followed by
    // either end-of-token or whitespace/`>`/`+`/`~`. We deliberately do NOT
    // match `#id.other` (compound — the `.other` class disambiguates intent)
    // or `tag#id` (the tag/class qualifier means the author already knows
    // about another selector form). We also skip pseudo-class/element forms
    // (`#id:hover`, `#id::before`) since the resolved bug only ever shows up
    // on bare layout rules. PostCSS gives us per-selector strings already
    // comma-split, so we just walk each one.
    const BARE_ID_HOST = /^#([A-Za-z_][\w-]*)(?:\s|>|\+|~|$)/;

    for (const style of styles) {
      let root: postcss.Root;
      try {
        root = postcss.parse(style.content);
      } catch {
        continue;
      }
      root.walkRules((rule) => {
        for (const selector of rule.selectors ?? []) {
          const trimmed = selector.trim();
          if (!trimmed.startsWith("#")) continue;
          const m = trimmed.match(BARE_ID_HOST);
          if (!m) continue;
          const idValue = m[1]!;
          // Negative: a real `id="<value>"` exists somewhere in the doc. The
          // CSS rule resolves normally — nothing to warn about.
          if (realIdSet.has(idValue)) continue;
          // Positive: some element carries `data-composition-id="<value>"`
          // but no element carries the matching `id` attribute. The ID
          // selector matches nothing.
          const wrapperTag = dataCompIdMap.get(idValue);
          if (!wrapperTag) continue;
          if (reported.has(idValue)) continue;
          reported.add(idValue);
          findings.push({
            code: "id_selector_on_data_composition_wrapper",
            severity: "error",
            message:
              `CSS selector \`#${idValue}\` targets an element that has ` +
              `\`data-composition-id="${idValue}"\` but no actual \`id="${idValue}"\` attribute. ` +
              "The ID selector matches nothing and the rule silently drops — any `display: flex`, " +
              "grid layout, or position declaration on this selector has zero effect at render time.",
            selector: `#${idValue}`,
            elementId: undefined,
            fixHint:
              `Either (a) change the CSS to the attribute selector \`[data-composition-id="${idValue}"]\`, ` +
              `OR (b) add an \`id="${idValue}"\` attribute to the wrapper \`<${wrapperTag.name}>\` so the ` +
              "existing `#id` selector resolves.",
            snippet: truncateSnippet(wrapperTag.raw),
          });
        }
      });
    }
    return findings;
  },

  // ── 19. scene_crossfade_must_use_autoalpha ──────────────────────────────
  // Recurring multi-scene bug observed across Porsche + Netflix reels:
  // master timeline fades in a scene with
  //   tl.fromTo('#beat-2', { opacity: 0 }, { opacity: 1, ... })
  // and later "deactivates" it with
  //   tl.set('#beat-2', { className: 'scene' }, 10.0)
  // GSAP leaves the inline `opacity: 1` it pushed onto the element. The
  // className flip swaps the class attribute but does NOT clear that inline
  // opacity — and inline style wins over the `.scene { opacity: 0 }` CSS
  // rule. The "deactivated" beat keeps rendering on top of every later beat,
  // so beat-4 never visibly wins the z-stack.
  //
  // Detection: for each `tl.set(target, { className: 'scene' }, t)` (or
  // `tl.to` className flip), look for a paired opacity fade-in on the same
  // target AND verify there is NO matching opacity:0 tween at the same
  // instant t. If either condition fails we have the broken pattern —
  // unless the author already uses `autoAlpha` on the same target.
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    if (scripts.length === 0) return findings;

    const isSceneTarget = (target: string): boolean => {
      const t = target.trim();
      // `#beat-N` / `#scene-N` host ids (with optional dash/underscore separator)
      if (/^#(?:beat|scene)[-_]?\d+$/i.test(t)) return true;
      // `.scene` class selector — scenes are typically class-tagged
      if (t === ".scene") return true;
      // Attribute selector targeting a composition host
      if (/\[data-composition-id\b/.test(t)) return true;
      return false;
    };

    type OpacityFadeIn = { target: string; raw: string; position: number | null };
    type OpacityFadeOut = { target: string; position: number | null };
    type ClassFlip = { target: string; position: number | null; raw: string };

    const fadeIns: OpacityFadeIn[] = [];
    const fadeOuts: OpacityFadeOut[] = [];
    const classFlips: ClassFlip[] = [];
    const autoAlphaTargets = new Set<string>();

    // Match tl/timeline/gsap calls with method, target, first props blob,
    // optional second props blob (for fromTo), optional position arg.
    //   .fromTo('#beat-2', { opacity: 0 }, { opacity: 1 }, 1.5)
    //   .to('#beat-2', { className: 'scene' }, 10)
    //   .set('#beat-2', { className: 'scene' }, 10)
    const callRe =
      /\b(?:tl|timeline|gsap)\.(fromTo|to|from|set)\s*\(\s*["']([^"']+)["']\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*(\{[\s\S]*?\}))?(?:\s*,\s*([0-9.]+))?\s*\)/g;

    const opacityValueRe = /\bopacity\s*:\s*([0-9.]+)/;
    const autoAlphaRe = /\bautoAlpha\s*:/;
    // className flip whose new class contains "scene" (the deactivation signal)
    const classFlipRe = /\bclassName\s*:\s*["']([^"']*\bscene\b[^"']*)["']/;

    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      callRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(cleaned)) !== null) {
        const method = m[1] || "";
        const target = m[2] || "";
        const propsA = m[3] || "";
        const propsB = m[4] || "";
        const posRaw = m[5];
        const position = posRaw != null ? Number(posRaw) : null;
        if (!isSceneTarget(target)) continue;

        // autoAlpha usage on this target — anywhere — exempts it from the rule.
        if (autoAlphaRe.test(propsA) || autoAlphaRe.test(propsB)) {
          autoAlphaTargets.add(target);
        }

        // className flip to a class that includes "scene" → the smoking gun.
        const flipA = classFlipRe.test(propsA);
        const flipB = classFlipRe.test(propsB);
        if ((method === "set" || method === "to") && (flipA || flipB)) {
          classFlips.push({ target, position, raw: m[0] });
        }

        // Opacity tween bookkeeping.
        const oa = opacityValueRe.exec(propsA);
        const ob = opacityValueRe.exec(propsB);
        if (method === "fromTo") {
          // fromTo: propsA is FROM, propsB is TO.
          if (oa && ob) {
            const from = Number(oa[1]);
            const to = Number(ob[1]);
            if (from === 0 && to > 0) {
              fadeIns.push({ target, raw: m[0], position });
            } else if (to === 0) {
              fadeOuts.push({ target, position });
            }
          }
        } else if (method === "to") {
          if (oa) {
            const to = Number(oa[1]);
            if (to > 0) fadeIns.push({ target, raw: m[0], position });
            else if (to === 0) fadeOuts.push({ target, position });
          }
        } else if (method === "from") {
          if (oa) {
            // from({opacity:0}) starts hidden, ends at current → counts as fade-in.
            const from = Number(oa[1]);
            if (from === 0) fadeIns.push({ target, raw: m[0], position });
          }
        }
      }
    }

    if (classFlips.length === 0) return findings;

    const reported = new Set<string>();
    for (const flip of classFlips) {
      // autoAlpha anywhere on this target = author already uses the safe pattern.
      if (autoAlphaTargets.has(flip.target)) continue;
      // The bug requires that the SAME target was previously faded in via opacity.
      const matchingFadeIn = fadeIns.find((f) => f.target === flip.target);
      if (!matchingFadeIn) continue;

      // Look for a matching opacity:0 tween "at the same instant" as the
      // className flip. We accept any of: explicit position equal to flip
      // position (within 0.01s), OR a fadeOut whose position is null
      // (conservative — can't prove it's NOT at the same instant).
      const flipPos = flip.position;
      const pairedFadeOut = fadeOuts.find((fo) => {
        if (fo.target !== flip.target) return false;
        if (flipPos == null || fo.position == null) return true;
        return Math.abs(fo.position - flipPos) <= 0.01;
      });
      if (pairedFadeOut) continue;

      const key = `${flip.target}|${flipPos ?? "?"}`;
      if (reported.has(key)) continue;
      reported.add(key);

      const tStr = flipPos != null ? ` at master t=${flipPos}s` : "";
      findings.push({
        code: "scene_crossfade_must_use_autoalpha",
        severity: "warning",
        message:
          `Scene \`${flip.target}\` uses \`tl.fromTo({ opacity: 0 -> 1 })\` to fade in and later ` +
          `\`tl.set({ className: 'scene' })\`${tStr} to deactivate, but GSAP retains the inline ` +
          "`opacity: 1` it pushed onto the element. The className flip swaps the class but doesn't " +
          "clear that inline opacity — inline style wins over the `.scene { opacity: 0 }` rule, so " +
          "the deactivated scene keeps covering every later beat.",
        selector: flip.target,
        fixHint:
          "Use `autoAlpha` instead of `opacity` for scene visibility — `autoAlpha: 0` sets " +
          "`visibility: hidden` AND `opacity: 0` atomically, so the deactivated scene can't paint. " +
          "Alternatively, pair the className kill with `tl.to(target, { opacity: 0, duration: 0 })` " +
          "at the same instant so GSAP clears its inline opacity.",
        snippet: truncateSnippet(flip.raw),
      });
    }

    return findings;
  },

  // ── 20. image_collapse_risk ─────────────────────────────────────────────
  // Observed on Amazon session 76a07b8d ("the white pill"). A
  // `<div class="product-card" style="background: white; padding: 24px;">`
  // wraps an `<img>` with `height: auto` and no `aspect-ratio`. When the
  // snapshot fires before the cross-origin image decodes, the img collapses
  // to 0px and only the parent's padded white background paints — a visible
  // empty container ("white pill") on the dark composition.
  //
  // Detection: for every <img>, when CSS resolves to BOTH
  //   - a width (100% or any explicit value), AND
  //   - height: auto or no height/aspect-ratio
  // AND the parent element has a non-transparent solid background that does
  // NOT match the composition root background, emit a warning.
  //
  // Skip:
  //   - img with `aspect-ratio` (browser reserves space pre-decode)
  //   - img with explicit pixel height (CSS or HTML attr)
  //   - img with HTML `height=""` attribute (explicit reserved space)
  ({ source, tags, styles, rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);

    // ── Determine composition root background so we can ignore parents
    // that simply match it (those don't paint a visible pill — their fill
    // blends into the canvas). We look at body/html/* CSS rules AND the
    // root tag's own decls + inline style.
    const rootBackgrounds = new Set<string>();
    const normalizeBg = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");

    const collectRootBg = (decls: DeclMap) => {
      const bg = decls["background"];
      const bgColor = decls["background-color"];
      if (bg) rootBackgrounds.add(normalizeBg(bg));
      if (bgColor) rootBackgrounds.add(normalizeBg(bgColor));
    };

    for (const [selector, decls] of declMap) {
      if (!/(?:^|\s|,)\s*(?:body|html|\*)\b/.test(selector)) continue;
      collectRootBg(decls);
    }
    if (rootTag) {
      collectRootBg(lookupDeclsForTag(rootTag, declMap));
    }
    for (const tag of tags) {
      if (tag.name === "body" || tag.name === "html") {
        collectRootBg(lookupDeclsForTag(tag, declMap));
      }
    }

    // True when the value paints a visible solid surface. Excludes
    // transparent, none, fully-transparent rgba(), and pure-gradient `none`.
    const isVisibleBackground = (value: string | undefined): boolean => {
      if (!value) return false;
      const v = value.trim().toLowerCase();
      if (!v) return false;
      if (
        v === "transparent" ||
        v === "none" ||
        v === "inherit" ||
        v === "initial" ||
        v === "unset"
      )
        return false;
      // rgba(..., 0) or hsla(..., 0) — fully transparent.
      if (/rgba\s*\([^)]*,\s*0(?:\.0+)?\s*\)/.test(v)) return false;
      if (/hsla\s*\([^)]*,\s*0(?:\.0+)?\s*\)/.test(v)) return false;
      return true;
    };

    const parentHasVisiblePill = (parentDecls: DeclMap): boolean => {
      const bg = parentDecls["background"];
      const bgColor = parentDecls["background-color"];
      const bgImage = parentDecls["background-image"];
      const visible =
        isVisibleBackground(bg) || isVisibleBackground(bgColor) || isVisibleBackground(bgImage);
      if (!visible) return false;
      // Suppress parents whose background matches the composition root
      // background — those don't paint a visible pill against the canvas.
      if (bg && rootBackgrounds.has(normalizeBg(bg))) return false;
      if (bgColor && rootBackgrounds.has(normalizeBg(bgColor))) return false;
      return true;
    };

    // True when `value` is a length in CSS pixels (e.g. `200px`, `50`). We
    // treat unitless and `px` values as "explicit pixels"; percentages and
    // `auto` do NOT reserve space pre-decode.
    const isPixelLength = (value: string | undefined): boolean => {
      if (!value) return false;
      const v = value.trim().toLowerCase();
      return /^-?\d+(?:\.\d+)?(?:px)?$/.test(v);
    };

    const reported = new Set<string>();

    for (const tag of tags) {
      if (tag.name !== "img") continue;

      // Skip when the HTML `height=""` attribute reserves space.
      const htmlHeight = readAttr(tag.raw, "height");
      if (htmlHeight && /^\d+(?:\.\d+)?(?:px)?$/i.test(htmlHeight.trim())) continue;

      const decls = lookupDeclsForTag(tag, declMap);

      // Already protected from collapse — explicit aspect-ratio or pixel height.
      if (decls["aspect-ratio"]) continue;
      if (isPixelLength(decls.height)) continue;

      // The collapse pattern requires a width that resolves but a height
      // that doesn't. "Width 100% or explicit" + "height auto or absent".
      const hasWidth = Boolean(decls.width);
      if (!hasWidth) continue;
      const heightValue = (decls.height || "").trim().toLowerCase();
      const heightIsAutoOrMissing = !heightValue || heightValue === "auto";
      if (!heightIsAutoOrMissing) continue;

      const parent = findParentTag(source, tags, tag);
      if (!parent) continue;
      const parentDecls = lookupDeclsForTag(parent, declMap);
      if (!parentHasVisiblePill(parentDecls)) continue;

      const selector =
        tagSelectorKeys(tag)[0] ||
        (readAttr(tag.raw, "src")
          ? `<img src="${readAttr(tag.raw, "src")!.slice(0, 60)}">`
          : `<img>`);
      const dedupeKey = selector;
      if (reported.has(dedupeKey)) continue;
      reported.add(dedupeKey);

      findings.push({
        code: "image_collapse_risk",
        severity: "warning",
        message:
          `Image '${selector}' inside parent with visible background may collapse to 0px during ` +
          "snapshot if the image doesn't decode in time, leaving a visible empty container " +
          "(e.g. a white pill on dark composition). Add explicit 'aspect-ratio: W/H' on the img " +
          "matching its source dimensions, OR set 'min-height' on the parent, OR remove the " +
          "visible background from the parent so a missing image renders invisibly.",
        selector,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint:
          "Add `aspect-ratio: <W>/<H>` on the img to match its source dimensions (the browser " +
          "reserves space before the image decodes), OR set an explicit `min-height:` on the parent, " +
          "OR drop the parent's visible background so a missing image leaves no visible pill.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // ── 21. opacity_zero_at_t0_with_no_immediate_tween ──────────────────────
  // Recurring snapshot/render bug: a composition does
  //   gsap.set(['.logo', '.headline', '.cta'], { opacity: 0 })
  // to hide every entrance target for staggered reveals, but the FIRST
  // opacity tween starts at +0.2s or later. The snapshot tool fires at the
  // exact beat-start instant (e.g. master t=0, t=5, t=12) and captures the
  // wrapper background with NOTHING painted on top — visible as "empty
  // pre-roll" frames at every scene cut.
  //
  // Detection:
  //   1. Walk scripts for `gsap.set(target, { opacity: 0 | autoAlpha: 0 })`
  //      calls — collect targets that are class/id selectors.
  //   2. Walk scripts for tweens (`tl.from`/`tl.fromTo`/`tl.to`,
  //      `gsap.from`/`gsap.fromTo`/`gsap.to`) bringing opacity > 0 and
  //      record their explicit position (0 if omitted).
  //   3. Find each visible element bearing a class/id and check whether it
  //      is covered by the set-to-zero list. If EVERY visible element is
  //      hidden by gsap.set, AND no reveal tween targets any of those
  //      elements at t ≤ 0.05s, emit a warning citing the earliest entrance
  //      time.
  //
  // The matching-tween check uses the same selector-coverage helper as
  // `tl_from_opacity_no_initial_set` so a `gsap.from('.logo', ...)` at t=0
  // satisfies a `gsap.set(['.logo'], ...)`. autoAlpha tweens count as
  // opacity reveals (`autoAlpha: 1` unhides).
  ({ source, scripts, tags, rootTag, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;
    if (!rootTag) return findings;
    if (scripts.length === 0) return findings;

    const parseFirstArgSelectors = (raw: string): string[] => {
      const trimmed = raw.trim();
      const quoted = trimmed.match(/^["']([^"']+)["']/);
      if (quoted) return [quoted[1]!];
      const arr = trimmed.match(/^\[([\s\S]*?)\]/);
      if (arr) {
        const items: string[] = [];
        const itemRe = /["']([^"']+)["']/g;
        let m: RegExpExecArray | null;
        while ((m = itemRe.exec(arr[1]!)) !== null) items.push(m[1]!);
        return items;
      }
      return [];
    };

    // ── 1. Collect gsap.set hidden targets. ────────────────────────────
    const setHidesRe =
      /opacity\s*:\s*0(?:\b|\s|,|})|autoAlpha\s*:\s*0(?:\b|\s|,|})|visibility\s*:\s*["']hidden["']/;
    const setCallRe = /\bgsap\.set\s*\(\s*([\s\S]*?)\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    const hiddenSelectors: string[] = [];
    // If a gsap.set targets an unresolvable expression (variable / DOM ref)
    // we treat it as covering all elements (conservative — we can't prove
    // it doesn't hide the rest).
    let unknownSetCoversAll = false;

    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      setCallRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = setCallRe.exec(cleaned)) !== null) {
        const propsBlob = m[2] || "";
        if (!setHidesRe.test(propsBlob)) continue;
        const sels = parseFirstArgSelectors(m[1] || "");
        if (sels.length === 0) {
          unknownSetCoversAll = true;
          continue;
        }
        for (const sel of sels) hiddenSelectors.push(sel);
      }
    }
    if (hiddenSelectors.length === 0 && !unknownSetCoversAll) return findings;

    // ── 2. Collect opacity-reveal tweens with their position. ──────────
    // A "reveal" is:
    //   - `.to({ opacity: N })` with N > 0
    //   - `.to({ autoAlpha: N })` with N > 0
    //   - `.from({ opacity: 0 | autoAlpha: 0 })` (starts hidden → ends visible)
    //   - `.fromTo({ opacity: 0 }, { opacity: N })` with N > 0
    //   - `.fromTo({ autoAlpha: 0 }, { autoAlpha: N })` with N > 0
    type RevealTween = { selector: string; position: number };
    const reveals: RevealTween[] = [];

    const tweenCallRe =
      /\b(?:tl|timeline|gsap)\.(to|from|fromTo)\s*\(\s*([\s\S]*?)\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*(\{[\s\S]*?\}))?(?:\s*,\s*([0-9.]+))?\s*\)/g;
    const opacityValueRe = /\b(?:opacity|autoAlpha)\s*:\s*([0-9.]+)/;

    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      tweenCallRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = tweenCallRe.exec(cleaned)) !== null) {
        const method = m[1] || "";
        const sels = parseFirstArgSelectors(m[2] || "");
        if (sels.length === 0) continue;
        const propsA = m[3] || "";
        const propsB = m[4] || "";
        const posRaw = m[5];
        const position = posRaw != null ? Number(posRaw) : 0;
        if (!Number.isFinite(position)) continue;

        let revealsOpacity = false;
        if (method === "fromTo") {
          const a = opacityValueRe.exec(propsA);
          const b = opacityValueRe.exec(propsB);
          if (a && b) {
            const from = Number(a[1]);
            const to = Number(b[1]);
            if (from === 0 && to > 0) revealsOpacity = true;
          }
        } else if (method === "to") {
          const a = opacityValueRe.exec(propsA);
          if (a) {
            const to = Number(a[1]);
            if (to > 0) revealsOpacity = true;
          }
        } else if (method === "from") {
          const a = opacityValueRe.exec(propsA);
          if (a) {
            const from = Number(a[1]);
            // from({opacity:0}) starts hidden, ends at current → counts as reveal.
            if (from === 0) revealsOpacity = true;
          }
        }
        if (!revealsOpacity) continue;
        for (const sel of sels) reveals.push({ selector: sel, position });
      }
    }

    // ── 3. Collect every visible element bearing a class/id. ───────────
    // We mirror `open_close_frame_visibility`'s "content vs wrapper" filter
    // so we don't count structural composition hosts.
    const VISIBLE_CONTENT_TAGS = new Set(["img", "video", "canvas", "svg", "picture", "iframe"]);
    const hasInlineText = (tag: OpenTag): boolean => {
      const openEnd = tag.index + tag.raw.length;
      const nextLt = source.indexOf("<", openEnd);
      const slice = nextLt === -1 ? source.slice(openEnd) : source.slice(openEnd, nextLt);
      return slice.replace(/&nbsp;/g, " ").trim().length > 0;
    };

    type VisibleEl = { tag: OpenTag; keys: string[] };
    const visibleEls: VisibleEl[] = [];
    for (const tag of tags) {
      if (
        [
          "script",
          "style",
          "link",
          "meta",
          "template",
          "noscript",
          "head",
          "title",
          "html",
          "body",
        ].includes(tag.name)
      )
        continue;
      // Skip composition hosts — they're structural, not visible payload.
      if (readAttr(tag.raw, "data-composition-id") || readAttr(tag.raw, "data-composition-src"))
        continue;
      const keys = tagSelectorKeys(tag);
      if (keys.length === 0) continue; // no class/id → can't be GSAP target
      const isContent = VISIBLE_CONTENT_TAGS.has(tag.name);
      if (!isContent && !hasInlineText(tag)) continue;
      visibleEls.push({ tag, keys });
    }
    if (visibleEls.length === 0) return findings;

    // ── 4. Every visible element must be covered by the hidden list. ───
    const hiddenSet = new Set(hiddenSelectors);
    if (!unknownSetCoversAll) {
      for (const el of visibleEls) {
        const covered = el.keys.some((k) => hiddenSet.has(k));
        if (!covered) return findings; // a visible element is NOT hidden → wrapper isn't blank
      }
    }

    // ── 5. Find earliest reveal tween targeting any hidden element. ────
    // A reveal at t ≤ 0.05s satisfies the "immediate entrance" condition.
    const IMMEDIATE_WINDOW = 0.05;
    let earliestReveal = Number.POSITIVE_INFINITY;
    for (const r of reveals) {
      // Reveal must target one of the hidden selectors directly, OR cover
      // them via descendant/compound match.
      const direct = hiddenSet.has(r.selector);
      let covers = direct;
      if (!covers) {
        for (const hidden of hiddenSet) {
          if (cssSelectorCoversTarget(source, tags, r.selector, hidden)) {
            covers = true;
            break;
          }
        }
      }
      // Also allow reveals targeting visible elements (covers reveal of a
      // descendant whose ancestor is in the hidden list).
      if (!covers) {
        for (const el of visibleEls) {
          if (el.keys.includes(r.selector)) {
            covers = true;
            break;
          }
          if (selectorMatchesTag(source, tags, r.selector, el.tag)) {
            covers = true;
            break;
          }
        }
      }
      if (!covers) continue;
      if (r.position < earliestReveal) earliestReveal = r.position;
    }

    // If any reveal lands at t ≤ 0.05s, the first frame is painted.
    if (Number.isFinite(earliestReveal) && earliestReveal <= IMMEDIATE_WINDOW) return findings;

    // No reveal at all → equally a problem (everything stays hidden).
    const tDisplay = Number.isFinite(earliestReveal) ? earliestReveal.toFixed(2) : "never";

    findings.push({
      code: "opacity_zero_at_t0_with_no_immediate_tween",
      severity: "warning",
      message:
        `Composition starts with all visible elements at opacity:0 and no element animates to ` +
        `visibility at t=0 (earliest entrance is at t=${tDisplay}s). The first frame after scene ` +
        "swap shows only the wrapper background. Keep at least one element (background, hero " +
        "image, headline) visible at t=0 and animate in details only.",
      fixHint:
        "Either (a) drop one element (the background, hero, or headline) from the gsap.set hidden " +
        "list so it paints at t=0; or (b) move the first reveal tween to position 0 (e.g. " +
        "`tl.to('.logo', { opacity: 1, duration: 0.3 }, 0)`); or (c) add a persistent CSS background " +
        "on the wrapper so the first frame isn't empty.",
    });

    return findings;
  },

  // ── 22. fabricated_brand_svg ────────────────────────────────────────────
  // Detect inline `<svg>` elements that look like an AI-fabricated brand mark.
  //
  // Observed bug (ChatGPT session ba98ca7c — mysterious black blob): the
  // agent encountered a site whose real logo uses external sprite references
  // (`<svg><use href="/cdn/sprites-core-X.svg#id">`), which do not survive
  // capture. The agent then INVENTED an inline `<svg>` from scratch with a
  // fabricated `<path d="...">` that doesn't match the real brand. Rendered
  // as a solid black blob with circle holes — nothing like the actual
  // ChatGPT/OpenAI logo. Brand-damaging.
  //
  // Heuristic (intentionally noisy — this is a warning, not an error):
  //   1. The `<svg>` itself, OR its parent, has a class containing one of
  //      the brand-suggesting tokens: `logo`, `brand`, `mark`, `icon`,
  //      `wordmark`. (Token-boundary aware so `.iconography-grid` and
  //      `.button-icon-row` don't accidentally trigger.)
  //   2. The `<svg>` body contains exactly ONE `<path>` element whose `d=`
  //      attribute is > 80 chars. Real brand marks are rarely a single short
  //      path — anything < 80 chars is almost certainly a generic UI icon.
  //   3. The composition has NO neighboring `<img src="...captures/.../assets/svgs/...">`
  //      reference, AND no nearby `<use href="...captures/.../assets/svgs/...">`,
  //      i.e. there is no captured brand asset that the agent could have used.
  //   4. The `<svg>` (or its parent) renders at >= 80px in either dimension,
  //      via HTML `width=`/`height=` attributes OR CSS width/height on the
  //      svg or its immediate parent. Icon-sized SVGs (< 80px) are not
  //      load-bearing brand marks.
  //
  // FP risk acknowledged: a legit hand-authored brand SVG with a real
  // single-path mark (some minimalist logos genuinely fit this shape) will
  // trip the warning. We emit at `warning` severity so it doesn't fail CI;
  // the message tells the author how to confirm.
  ({ source, tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];

    // ── 0. Collect every captured-asset URL referenced in the composition.
    // If ANY `<img src>` / `<use href>` / CSS `url(...)` points at the
    // canonical `captures/<site>/assets/svgs/` location, the agent had a
    // real captured asset available — fabrication is a stretch and we stay
    // silent. This is intentionally a composition-wide check rather than
    // a per-svg neighbor check: if even one captured logo is in use, the
    // composition was wired up correctly and any other inline `<svg>` is
    // most likely a real decorative icon.
    const CAPTURED_SVG_RE = /captures\/[^/"'\s]+\/assets\/svgs\//i;
    let hasCapturedAsset = false;
    // Scan all `<img>` / `<use>` / `<image>` attribute values.
    for (const tag of tags) {
      if (tag.name !== "img" && tag.name !== "use" && tag.name !== "image") continue;
      const src = readAttr(tag.raw, "src") || readAttr(tag.raw, "href") || "";
      if (CAPTURED_SVG_RE.test(src)) {
        hasCapturedAsset = true;
        break;
      }
    }
    // Scan CSS `url(...)` references.
    if (!hasCapturedAsset) {
      const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
      for (const style of styles) {
        CSS_URL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CSS_URL_RE.exec(style.content)) !== null) {
          if (CAPTURED_SVG_RE.test(m[1] || "")) {
            hasCapturedAsset = true;
            break;
          }
        }
        if (hasCapturedAsset) break;
      }
    }
    if (hasCapturedAsset) return findings;

    // ── 1. Brand-token detector (token-boundary aware to avoid FPs like
    // `.iconography`, `.button-icon-row`, `.bookmark`). Token matches when
    // it appears as its own word inside a kebab/snake/space-separated class
    // attribute. We allow `-` and `_` as separators so `.chatgpt-logo` and
    // `.brand_mark` both match, but `.iconography` does not.
    const BRAND_TOKEN_RE = /(?:^|[\s_-])(logo|brand|mark|icon|wordmark)(?:$|[\s_-])/i;

    const declMap = buildSelectorDeclMap(styles);
    mergeInlineStylesIntoMap(tags, declMap);

    // ── 2. Helper: pixel-size readout for an svg + its parent. Returns the
    // largest dimension we can resolve (width or height) in CSS px. Checks
    // HTML attributes first (the SVG carries `width="120"`), then CSS
    // declarations (covers `.logo { width: 120px }` on the svg or parent).
    const parsePx = (value: string | undefined): number => {
      if (!value) return Number.NaN;
      const m = /^(-?\d+(?:\.\d+)?)\s*px?$/i.exec(value.trim());
      if (m) return Number(m[1]);
      const bare = /^(-?\d+(?:\.\d+)?)$/.exec(value.trim());
      if (bare) return Number(bare[1]);
      return Number.NaN;
    };
    const tagSizePx = (tag: OpenTag): number => {
      // HTML attributes on the tag.
      const attrW = parsePx(readAttr(tag.raw, "width") || undefined);
      const attrH = parsePx(readAttr(tag.raw, "height") || undefined);
      // CSS declarations resolved through declMap (covers id+class selectors).
      const decls = lookupDeclsForTag(tag, declMap);
      const cssW = parsePx(decls.width);
      const cssH = parsePx(decls.height);
      // Return the max of any finite value, NaN if none.
      const candidates = [attrW, attrH, cssW, cssH].filter((v) => Number.isFinite(v));
      if (candidates.length === 0) return Number.NaN;
      return Math.max(...candidates);
    };

    // ── 3. Walk every inline `<svg>` open tag and apply heuristics a-c.
    const reported = new Set<number>();

    for (const svg of tags) {
      if (svg.name !== "svg") continue;
      if (reported.has(svg.index)) continue;

      // Heuristic 1: brand-token in svg's own class OR parent's class.
      const svgClass = readAttr(svg.raw, "class") || "";
      let brandClass: string | null = null;
      if (BRAND_TOKEN_RE.test(svgClass)) brandClass = svgClass;
      if (!brandClass) {
        const parent = findParentTag(source, tags, svg);
        if (parent) {
          const parentClass = readAttr(parent.raw, "class") || "";
          if (BRAND_TOKEN_RE.test(parentClass)) brandClass = parentClass;
        }
      }
      if (!brandClass) continue;

      // Heuristic 2: exactly one `<path>` with substantial `d=` data.
      // Scope to the svg's own content range so we don't count paths from
      // a later svg further down the document.
      const svgEnd = findTagEndIndex(source, svg);
      const body = source.slice(svg.index, svgEnd);
      const PATH_TAG_RE = /<path\b[^>]*>/gi;
      const pathMatches = body.match(PATH_TAG_RE) || [];
      if (pathMatches.length !== 1) continue;
      const dValue = readAttr(pathMatches[0]!, "d") || "";
      if (dValue.length <= 80) continue;

      // Heuristic 2b: skip svgs that use external sprite references
      // (`<use href="...">`). The fabricated-brand pattern is specifically
      // *inlined* paths — when the svg uses a sprite reference, even if
      // the sprite never loaded, we don't fault the author.
      if (/<use\b[^>]*\bhref\s*=/i.test(body)) continue;

      // Heuristic 4: size gate. Need >= 80px on at least one axis on the
      // svg itself or its immediate parent. Many brand marks have no
      // explicit size — fall back to viewBox dimensions when present (an
      // svg with viewBox="0 0 200 200" and no width/height defaults to
      // its viewBox size in modern browsers).
      let sizePx = tagSizePx(svg);
      if (!Number.isFinite(sizePx)) {
        const parent = findParentTag(source, tags, svg);
        if (parent) sizePx = tagSizePx(parent);
      }
      if (!Number.isFinite(sizePx)) {
        const viewBox = readAttr(svg.raw, "viewBox") || "";
        const vbMatch =
          /^\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/.exec(viewBox);
        if (vbMatch) {
          const vbW = Number(vbMatch[1]);
          const vbH = Number(vbMatch[2]);
          if (Number.isFinite(vbW) && Number.isFinite(vbH)) sizePx = Math.max(vbW, vbH);
        }
      }
      if (!Number.isFinite(sizePx) || sizePx < 80) continue;

      reported.add(svg.index);
      const pathLen = dValue.length;
      findings.push({
        code: "fabricated_brand_svg",
        severity: "warning",
        message:
          `Inline <svg class="${svgClass || brandClass}"> with a single ~${pathLen}-char path is likely ` +
          `a fabricated brand mark. The capture for this site may have failed to extract a usable logo ` +
          `asset (often when the site uses external sprite-sheet references via <use href>). ` +
          `Fabricated SVG paths rarely match real brand identities and render as confused silhouettes.`,
        selector: svgClass ? `svg.${svgClass.split(/\s+/)[0]}` : `<svg>`,
        elementId: readAttr(svg.raw, "id") || undefined,
        fixHint:
          `Replace with a text wordmark (e.g. <span>{site_name}</span>), OR use a captured asset ` +
          `from captures/<site>/assets/svgs/, OR omit the logo and use the site's hero image instead.`,
        snippet: truncateSnippet(svg.raw),
      });
    }
    return findings;
  },
];
