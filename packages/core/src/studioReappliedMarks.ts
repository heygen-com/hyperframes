/** Studio edit marks only the preview's seek-reapply script keeps applied; a page loaded with none has no script. */
export const STUDIO_REAPPLIED_MARKS = [
  { name: "data-hf-studio-path-offset", value: "true" },
  { name: "data-hf-studio-box-size", value: "true" },
  { name: "data-hf-studio-rotation", value: "true" },
  { name: "data-hf-studio-motion", value: null },
] as const;

/** Set on the page's window by that script once it has started keeping the marks applied. */
export const STUDIO_SEEK_REAPPLY_STARTED = "__hfStudioSeekReapplyStarted";

// Attribute names match in any case and quoting; a value must match exactly, as the script's selector does.
const MARK_IN_HTML = STUDIO_REAPPLIED_MARKS.map(({ name, value }) =>
  value === null
    ? (html: string) => new RegExp(`\\s${name}\\s*=`, "i").test(html)
    : (html: string) =>
        [...html.matchAll(new RegExp(`\\s${name}\\s*=\\s*(["']?)([^"'\\s/>]*)\\1`, "gi"))].some(
          (match) => match[2] === value,
        ),
);
export const htmlHasStudioReappliedMark = (html: string) => MARK_IN_HTML.some((has) => has(html));

export const isStudioMotionMark = (name: string) => name.startsWith("data-hf-studio-motion");
