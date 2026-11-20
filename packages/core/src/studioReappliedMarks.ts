/** Studio edit marks only the preview's seek-reapply script keeps applied; a page loaded with none has no script. */
export const STUDIO_REAPPLIED_MARKS = [
  { name: "data-hf-studio-path-offset", value: "true" },
  { name: "data-hf-studio-box-size", value: "true" },
  { name: "data-hf-studio-rotation", value: "true" },
  { name: "data-hf-studio-motion", value: null },
] as const;

export const STUDIO_REAPPLIED_MARK_SELECTOR = STUDIO_REAPPLIED_MARKS.map(({ name, value }) =>
  value === null ? `[${name}]` : `[${name}="${value}"]`,
).join(", ");

export const isStudioMotionMark = (name: string) => name.startsWith("data-hf-studio-motion");
