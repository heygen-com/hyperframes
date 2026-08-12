const MAX_TELEMETRY_STRING_LENGTH = 240;

function truncateTelemetryString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function redactUrlQueryStrings(value: string): string {
  return value.replace(/\b(https?:\/\/[^\s?]+)\?[^\s]*/g, "$1?…");
}

/**
 * Path characters we treat as part of a single segment. Space is deliberately
 * excluded: including it would let a match run past the path and swallow the
 * prose after it, and a path with a space still gets its remaining segments
 * redacted, which is the part that carries the identifying information.
 */
/**
 * A path segment is defined by what ENDS it, not by an alphabet.
 *
 * `[\w...]` is ASCII-only, so `/数据/客户/秘密视频.mp4` and `/data/客户/secret.mp4`
 * passed through completely unredacted — the generic redactor also feeds CLI
 * telemetry and producer observation messages, where no known-path list is
 * supplied to cover for it. Enumerating Unicode classes instead (`\p{L}\p{N}…`)
 * would work but has to be kept correct for marks, joiners and emoji; a
 * delimiter-based rule is right for every script by construction.
 *
 * Whitespace and quotes end a segment; so do the separators themselves.
 * Space stays excluded for the original reason: including it would let a match
 * run past the path and swallow the prose after it.
 */
const SEGMENT = String.raw`[^\s/\\'"]+`;

/** Same, minus the dot, so a trailing `.ext` can be matched separately. */
const SEGMENT_NODOT = String.raw`[^\s/\\'".]+`;

/**
 * Once a match is established as a path, consume the rest of the token.
 * Windows forbids `?` in a filename, so `video.mov?not-a-query` is not a real
 * query string — but stopping at the `?` would emit the remainder verbatim.
 * Redacting to the next delimiter cannot leak; stopping early can.
 */
const TOKEN_TAIL = String.raw`[^\s'")]*`;

/**
 * Absolute path, any root — NOT an allowlist of roots.
 *
 * The previous version enumerated `/Users`, `/home`, `/opt`, `/tmp`… which
 * meant a project on `/data`, `/Volumes/External`, an NFS mount or any root a
 * user invented reached telemetry verbatim. Two or more segments are required
 * so `N/A` and a `24/1` frame rate — both ordinary in ffprobe stderr — are not
 * mistaken for paths.
 *
 * The lookbehind keeps this off URLs: after `https:` the slash is preceded by
 * `:`, the second by `/`, and the path segment by a word character, so no
 * position inside a URL can start a match. URLs are handled above, where the
 * host is kept and only the query is dropped.
 */
const ABSOLUTE_PATH = new RegExp(
  String.raw`(?<![:\w/\\])(?:[A-Za-z]:)?(?:[\\/]${SEGMENT}){2,}${TOKEN_TAIL}`,
  "g",
);

/** `./assets/bgm.mp3`, `../out.wav`, `.\tmp\x` — relative paths leak the same
 *  project structure absolute ones do, and were previously untouched. */
const RELATIVE_PATH = new RegExp(
  String.raw`(?<![\w/\\.])\.{1,2}(?:[\\/]${SEGMENT})+${TOKEN_TAIL}`,
  "g",
);

/**
 * A bare basename with an asset extension. ffprobe reports the input by the
 * name it was given, so a caller that passes a basename (or a path this
 * flattened to its last segment) still names the user's file.
 *
 * The lookbehind excludes a slash so this cannot re-redact the tail of a URL
 * whose host we deliberately keep.
 */
const ASSET_BASENAME =
  /(?<![\w/\\])[^\s/\\'"]+\.(?:mp4|mov|mkv|webm|avi|m4v|mpe?g|ts|mp3|wav|aac|m4a|flac|ogg|opus|png|jpe?g|gif|webp|svg|html?|json|srt|vtt|ass)\b/gi;

/**
 * A relative path with NO `./` prefix — `assets/bgm.mp3`,
 * `customer/acme-secret/video.mp4`. These leak exactly as much as an absolute
 * path and were missed by both rules above: the absolute rule requires a
 * leading slash, and the `./` rule requires the dot.
 *
 * Qualifying needs either two separators or one plus a file extension, so the
 * ordinary non-paths in ffprobe stderr — `N/A`, a `24/1` frame rate,
 * `48000/1001` — do not match. The lookbehind keeps it off URL paths, whose
 * host is deliberately kept.
 */
const BARE_RELATIVE_PATH = new RegExp(
  [
    // Two or more separators: `customer/acme/video.mp4`. No extension needed —
    // that much structure is already a path.
    String.raw`(?<![^\s'\"(=,\[])(?:${SEGMENT}[\\/]){2,}${SEGMENT}${TOKEN_TAIL}`,
    // One separator, but the last segment carries a file extension:
    // `assets/bgm.mp3`. That segment is dot-free on purpose — SEGMENT includes
    // `.`, so a greedy one swallows the extension this rule needs.
    String.raw`(?<![^\s'\"(=,\[])${SEGMENT}[\\/]${SEGMENT_NODOT}\.\w{1,8}\b${TOKEN_TAIL}`,
  ].join("|"),
  "g",
);

/**
 * Redact literal strings — the exact paths a caller KNOWS it passed — before
 * any shape-based rule runs.
 *
 * Shape matching is a net with holes by construction; this is not. When the
 * caller has the path in hand (it built the argv), spell it out rather than
 * hoping a regex recognises it, and take the basename too since ffprobe often
 * reports only that.
 */
export function redactKnownPaths(value: string, paths: readonly string[]): string {
  // Fail soft on a non-string. This sits on an error path, so throwing here
  // converts a reported failure into an unhandled rejection — which is exactly
  // what happened when a caller passed a non-Error rejection's `.message`.
  if (typeof value !== "string") return "";
  let out = value;
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0) continue;
    // Longest first: replacing the basename before the full path would leave
    // the directory prefix stranded.
    const basename = path.split(/[\\/]/).pop() ?? "";
    for (const literal of [path, basename].filter((v) => v.length > 2)) {
      out = out.split(literal).join("[path]");
    }
  }
  return out;
}

function redactFilePaths(value: string): string {
  return (
    value
      .replace(/file:\/\/[^\s'")]+/g, "[file-url]")
      // Relative BEFORE absolute: `./assets/x.mp3` has an absolute-looking tail
      // (`/assets/x.mp3`), so the absolute rule would consume it and leave the
      // leading `.` stranded outside the redaction.
      .replace(RELATIVE_PATH, "[path]")
      // Bare-relative BEFORE absolute: a bare path's interior satisfies the
      // absolute rule, which would claim it and strand the first segment.
      .replace(BARE_RELATIVE_PATH, "[path]")
      .replace(ABSOLUTE_PATH, "[path]")
      .replace(ASSET_BASENAME, "[file]")
  );
}

export function redactTelemetryString(
  value: string,
  maxLength = MAX_TELEMETRY_STRING_LENGTH,
): string {
  return truncateTelemetryString(redactFilePaths(redactUrlQueryStrings(value)), maxLength);
}
