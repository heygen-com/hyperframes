import { execFileSync } from "node:child_process";

export function heygenSearch(subcommand, query, { type, limit = 5, minScore } = {}) {
  // execFileSync with an argv array (no shell), so query/type/etc. are passed as
  // literal arguments — no quoting tricks, no command injection. subcommand is a
  // hardcoded multi-word string (e.g. "audio sounds list"), split into tokens.
  // Tag the caller via the CLI's allowlisted attribution header (heygen >= v0.1.6).
  const args = [
    "--headers",
    "X-HeyGen-Client-Source: media-use",
    ...subcommand.split(" "),
    "--query",
    query,
  ];
  if (type) args.push("--type", type);
  args.push("--limit", String(limit));
  // Server-side score floor. Honored by `audio sounds list`; the `asset search`
  // backend rejects it, so only audio providers pass minScore (see image-provider).
  if (minScore != null) args.push("--min-score", String(minScore));

  let out;
  try {
    out = execFileSync("heygen", args, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    // Don't swallow a broken command / auth failure as "no results" — that turns
    // a typo or expired key into a silent dead end. Surface it, then give up.
    const detail = err.stderr?.toString().trim() || err.stdout?.toString().trim() || err.message;
    console.error(`media-use: \`heygen ${subcommand}\` failed: ${detail}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    console.error(`media-use: \`heygen ${subcommand}\` returned non-JSON output`);
    return null;
  }
  if (parsed?.error) {
    const e = parsed.error;
    console.error(`media-use: \`heygen ${subcommand}\` error: ${e.message ?? JSON.stringify(e)}`);
    return null;
  }

  const data = parsed?.data;
  return Array.isArray(data) && data.length > 0 ? data : null;
}
