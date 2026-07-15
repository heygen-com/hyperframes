interface FindingSuggestion {
  category:
    | "static_scene"
    | "text_overflow"
    | "flat_background"
    | "abrupt_scene_change"
    | "low_contrast";
  findingCodes: readonly string[];
  components: readonly string[];
  reason: string;
  commandLead?: string;
  alternative?: string;
}

const FINDING_SUGGESTIONS: readonly FindingSuggestion[] = [
  {
    category: "static_scene",
    findingCodes: ["sweep_static", "motion_frozen"],
    components: ["drift-hold"],
    reason: "a static hold can carry motion",
  },
  {
    category: "text_overflow",
    findingCodes: ["text_box_overflow", "clipped_text", "canvas_overflow"],
    components: ["headline-slam"],
    reason: "oversized copy can reuse the fit pattern",
    commandLead: " from ",
  },
  {
    category: "flat_background",
    findingCodes: ["flat_background"],
    components: ["aurora-drift", "grain-field"],
    reason: "a flat background can gain ambient depth",
  },
  {
    category: "abrupt_scene_change",
    findingCodes: ["abrupt_scene_change", "content_overlap"],
    components: ["cut-the-curve"],
    reason: "an abrupt scene change can use matched motion",
    alternative: "a crossfade",
  },
  {
    category: "low_contrast",
    findingCodes: ["contrast_aa_failure"],
    components: [],
    reason: "low contrast should be corrected with the composition theme tokens",
  },
];

export function registrySuggestionForFinding(code: string): string | undefined {
  const suggestion = FINDING_SUGGESTIONS.find(({ findingCodes }) => findingCodes.includes(code));
  if (!suggestion) return undefined;
  if (suggestion.components.length === 0) return suggestion.reason;

  const commands = suggestion.components
    .map((component) => `'hyperframes add ${component}'`)
    .join(" or ");
  const alternative = suggestion.alternative ? ` or ${suggestion.alternative}` : "";
  return `${suggestion.reason}${suggestion.commandLead ?? " via "}${commands}${alternative}`;
}
