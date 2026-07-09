import type { RegistryItem } from "./types.js";

export type RegistryProvenanceSubject = Pick<RegistryItem, "tags" | "sourceUrl" | "sourcePrompt">;

export type RegistryProvenanceFinding = {
  code: "provenance_port_tag_missing_source";
  severity: "warning";
  message: string;
  fixHint: string;
};

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function checkProvenanceTags(
  item: RegistryProvenanceSubject,
): RegistryProvenanceFinding | null {
  const portTags = (item.tags ?? []).filter((tag) => tag.toLowerCase().endsWith("-port"));
  if (portTags.length === 0) return null;
  if (hasText(item.sourceUrl) || hasText(item.sourcePrompt)) return null;

  return {
    code: "provenance_port_tag_missing_source",
    severity: "warning",
    message:
      `Registry item tag(s) ${portTags.join(", ")} claim this item was ported from an external source, ` +
      "but neither sourceUrl nor sourcePrompt is recorded, so the claim is unverifiable.",
    fixHint:
      "Add sourceUrl for the external source, add sourcePrompt for prompt-derived provenance, or remove the -port tag.",
  };
}
