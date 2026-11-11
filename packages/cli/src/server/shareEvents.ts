import type { LocalShareInteraction } from "@hyperframes/studio-server";

export function shareEventInput(value: unknown): LocalShareInteraction | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !("event" in value)) return null;
  if (value.event === "share_link_copied" && "via" in value && value.via === "copy")
    return { event: value.event, via: "copy" };
  if (value.event !== "share_opened" || !("link" in value)) return null;
  const link = ["none", "live", "changed"] as const;
  const chosen = link.find((item) => item === value.link);
  return chosen ? { event: value.event, link: chosen } : null;
}
