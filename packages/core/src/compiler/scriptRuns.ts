export interface InlineScriptRun {
  members: Element[];
  /** First later script that executes on its own; the merged run must stay before it. Null: end of body. */
  anchor: Element | null;
}

function isClassicInline(el: Element): boolean {
  const type = (el.getAttribute("type") || "").trim().toLowerCase();
  return !type || type === "text/javascript" || type === "application/javascript";
}

function isSeparateExecution(el: Element, isPinned: (el: Element) => boolean): boolean {
  return (
    el.hasAttribute("src") ||
    isPinned(el) ||
    (el.getAttribute("type") || "").trim().toLowerCase() === "module"
  );
}

/** Groups body scripts into runs of classic inline scripts split by any script that executes
 * separately (src, module, or one the caller pins in place), so merging a run never reorders it past one. */
export function inlineScriptRuns(
  scripts: readonly Element[],
  isPinned: (el: Element) => boolean = () => false,
): InlineScriptRun[] {
  const runs: InlineScriptRun[] = [];
  let members: Element[] = [];
  for (const el of scripts) {
    if (isSeparateExecution(el, isPinned)) {
      if (members.length === 0) continue;
      runs.push({ members, anchor: el });
      members = [];
    } else if (isClassicInline(el)) {
      members.push(el);
    }
  }
  if (members.length > 0) runs.push({ members, anchor: null });
  return runs;
}

export const AFTER_FONTS_SCRIPT_TYPE = "text/hf-after-fonts";
const AFTER_FONTS_MODULE_TYPE = `${AFTER_FONTS_SCRIPT_TYPE}+module`;
export const AFTER_FONTS_SCRIPTS = `script[type="${AFTER_FONTS_SCRIPT_TYPE}"], script[type="${AFTER_FONTS_MODULE_TYPE}"]`;

/** Gives each body script a type the browser does not run, so the runtime can run it once web fonts are ready. */
export function deferScriptsUntilFonts(
  document: Document,
  isFramework: (el: Element) => boolean = () => false,
): void {
  for (const el of document.querySelectorAll("body script")) {
    if (isFramework(el) || el.closest("noscript, svg")) continue;
    if (isClassicInline(el)) el.setAttribute("type", AFTER_FONTS_SCRIPT_TYPE);
    else if ((el.getAttribute("type") || "").trim().toLowerCase() === "module") {
      el.setAttribute("type", AFTER_FONTS_MODULE_TYPE);
    }
  }
}

export function typeAfterFonts(el: Element): string | null {
  const type = el.getAttribute("type");
  if (type === AFTER_FONTS_SCRIPT_TYPE) return null;
  return type === AFTER_FONTS_MODULE_TYPE ? "module" : type;
}

/** Undefined for a type the browser never applies as CSS; `media="all"` and an empty title count as none. */
export function cssStyleMergeKey(el: Element): string | undefined {
  const rawType = el.getAttribute("type") ?? "";
  // Chrome reads a link's type as a MIME type, so parameters are allowed; a style's must match exactly.
  const type = el.tagName.toLowerCase() === "link" ? rawType.split(";")[0]!.trim() : rawType;
  if (type !== "" && type.toLowerCase() !== "text/css") return undefined;
  const media = (el.getAttribute("media") ?? "").trim().toLowerCase();
  return JSON.stringify([media === "all" ? "" : media, el.getAttribute("title") ?? ""]);
}

export const UNCONDITIONAL_CSS_KEY = JSON.stringify(["", ""]);

/** A link's identity and condition; fetch attributes (crossorigin, integrity, referrerpolicy) are not compared. */
function linkDedupeKey(el: Element): string {
  return JSON.stringify([
    el.getAttribute("href"),
    (el.getAttribute("rel") ?? "").trim().toLowerCase(),
    cssStyleMergeKey(el) ?? el.getAttribute("type"),
    el.hasAttribute("disabled"),
  ]);
}

export function hasSameLink(scope: ParentNode, link: Element): boolean {
  const key = linkDedupeKey(link);
  return [...scope.querySelectorAll("link[href]")].some(
    (other) => !other.closest("noscript") && linkDedupeKey(other) === key,
  );
}

/** Groups head styles into runs of adjacent styles with one merge key, so merging a run never reorders rules. */
export function headStyleRuns(
  styles: readonly Element[],
  isPinned: (el: Element) => boolean = () => false,
): Element[][] {
  const runs: Element[][] = [];
  let previousKey: string | undefined;
  for (const el of styles) {
    const key = isPinned(el) ? undefined : cssStyleMergeKey(el);
    if (key !== undefined && key === previousKey) runs.at(-1)!.push(el);
    else if (key !== undefined) runs.push([el]);
    previousKey = key;
  }
  return runs;
}

export interface CompositionStyle {
  css: string;
  media: string | null;
  title: string | null;
}

export function compositionStyle(el: Element, css: string): CompositionStyle {
  return { css, media: el.getAttribute("media"), title: el.getAttribute("title") };
}

/** One `<style>` per adjacent run of same-condition sheets, keeping each run's media and title. */
export function styleElementsFor(
  document: Document,
  sheets: readonly CompositionStyle[],
  join: (css: string[]) => string,
): Element[] {
  const elements = sheets.map(({ css, media, title }) => {
    const el = document.createElement("style");
    if (media !== null) el.setAttribute("media", media);
    if (title !== null) el.setAttribute("title", title);
    el.textContent = css;
    return el;
  });
  return headStyleRuns(elements).map((run) => {
    run[0]!.textContent = join(run.map((el) => el.textContent || ""));
    return run[0]!;
  });
}
