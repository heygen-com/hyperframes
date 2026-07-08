import type { RegistrationInfo } from "./types.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n\r]*/g, "$1");
}

function removeRegistrySetup(source: string): string {
  return source
    .replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;?/g, "")
    .replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\[\]\s*;?/g, "")
    .replace(
      /if\s*\(\s*!window\.__timelines\s*\)\s*\{\s*window\.__timelines\s*=\s*\{\}\s*;?\s*\}/g,
      "",
    );
}

export function parseRegistrationPostamble(
  postamble: string,
  timelineVar: string,
): RegistrationInfo | null {
  const trimmed = stripComments(postamble).trim();
  if (trimmed === "") return { id: "main" };

  const withoutSetup = removeRegistrySetup(trimmed);
  const escapedVar = escapeRegExp(timelineVar);
  const assignment = new RegExp(
    `window\\.__timelines\\s*\\[\\s*["']([^"']+)["']\\s*\\]\\s*=\\s*${escapedVar}\\s*;?`,
    "g",
  );
  const push = new RegExp(`window\\.__timelines\\.push\\s*\\(\\s*${escapedVar}\\s*\\)\\s*;?`, "g");
  let id = "main";
  let consumed = withoutSetup.replace(assignment, (_match, key: string) => {
    id = key;
    return "";
  });
  consumed = consumed.replace(push, "");
  return consumed.trim() === "" ? { id } : null;
}

export function stripLegacyRegistrySetup(preamble: string): string {
  return removeRegistrySetup(preamble);
}
