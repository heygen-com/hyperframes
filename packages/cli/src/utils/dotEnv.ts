import { FEEDBACK_EMAIL_ENV } from "./feedbackSource.js";

/**
 * A project `.env`'s keys copied into `env`, never over one already set. The feedback email is skipped: only the app
 * that launched the CLI may attach it, and a project file is something an agent can write.
 */
export function applyDotEnv(content: string, env: NodeJS.ProcessEnv): void {
  for (const rawLine of content.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // Tolerate `export FOO=bar` (common in dotfile-style .env files).
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (val.startsWith('"') || val.startsWith("'")) {
      // Quoted value: take until the matching closing quote; leave the rest.
      // Anything after a closing quote (including `# comment`) is dropped.
      const quote = val.charAt(0);
      const end = val.indexOf(quote, 1);
      if (end > 0) val = val.slice(1, end);
      else val = val.slice(1); // unterminated quote — best-effort, strip opener
    } else {
      // Unquoted value: strip inline `# comment` (requires whitespace before #
      // to avoid eating `pass#word` style values).
      const commentMatch = val.match(/\s+#/);
      if (commentMatch?.index !== undefined) val = val.slice(0, commentMatch.index).trim();
    }
    if (key && key !== FEEDBACK_EMAIL_ENV && !(key in env)) env[key] = val;
  }
}
