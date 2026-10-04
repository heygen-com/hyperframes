import { FEEDBACK_EMAIL_ENV } from "./feedbackSource.js";

// A quoted value ends at its closing quote; unquoted, `#` starts a comment only after whitespace, so `pass#word` stays.
function valueOf(raw: string): string {
  const quote = raw.charAt(0);
  if (quote === '"' || quote === "'") {
    const end = raw.indexOf(quote, 1);
    return end > 0 ? raw.slice(1, end) : raw.slice(1);
  }
  const comment = raw.match(/\s+#/);
  return comment?.index === undefined ? raw : raw.slice(0, comment.index).trim();
}

function entryOf(rawLine: string): [string, string] | null {
  let line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;
  if (line.startsWith("export ")) line = line.slice(7).trim();
  const eq = line.indexOf("=");
  if (eq < 1) return null;
  return [line.slice(0, eq).trim(), valueOf(line.slice(eq + 1).trim())];
}

// Never over a key already set, and never the feedback email in any letter case (Windows env names are case-blind):
// only the launching app may attach it, and an agent can write a project `.env`.
export function applyDotEnv(content: string, env: NodeJS.ProcessEnv): void {
  for (const entry of content.split("\n").map(entryOf)) {
    if (!entry) continue;
    const [key, value] = entry;
    if (key && key.toUpperCase() !== FEEDBACK_EMAIL_ENV && !(key in env)) env[key] = value;
  }
}
