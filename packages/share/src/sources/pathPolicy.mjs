// @ts-check
// Validate source manifests against the bundled sync contract.
import { isPrivateSourcePath, privateSourceSpelling } from "./privateSource.mjs";
export { isPrivateSourcePath };
import { readContract } from "./contract.mjs";
import {
  UNICODE_VERSION,
  allAssigned,
  comparisonKey,
  v4ComparisonKey,
  nfc,
  withoutIgnorable,
} from "./unicode.mjs";

const PATH_POLICY_VERSION = "portable-source-v12";

/** @typedef {import("./types.js").PathRule} PathRule @typedef {import("./types.js").PolicyDocument} PolicyDocument */

/** A path the policy refuses: `code` is the golden vectors' shared vocabulary, `rule` the excluding rule's id. */
export class PathViolation extends Error {
  /** @param {string} code @param {string} path @param {string} [rule] */
  constructor(code, path, rule) {
    super(`${code}: ${JSON.stringify(path)}${rule ? ` (${rule})` : ""}`);
    this.name = "PathViolation";
    this.code = code;
    this.path = path;
    this.rule = rule ?? null;
  }
}

const ASCII = /^\p{ASCII}*$/u;

/** @param {string} pattern */
const whole = (pattern) => new RegExp(`^(?:${pattern})$`, "su");
/** @param {string} text */
const escaped = (text) => text.replace(/[\\\]^-]/g, "\\$&");

/** Every stem of a Windows 8.3 short name of `names`: a prefix of each name, its leading dot dropped, 2 to 6 long
 * (the whole name when shorter), also with the dots before its extension dropped, as Windows shortens
 * the name .aider.conf.yml to AIDERC~1.YML. @param {readonly string[]} names */
function shortNameStems(names) {
  /** @type {Set<string>} */
  const stems = new Set();
  for (const name of names) {
    const bare = comparisonKey(name).replace(/^\./, "");
    const dot = bare.lastIndexOf(".");
    const base = dot > 0 ? bare.slice(0, dot).replaceAll(".", "") : bare;
    for (const spelled of [bare, base]) {
      const longest = Math.min(6, spelled.length);
      for (let length = Math.min(2, longest); length <= longest; length++)
        stems.add(spelled.slice(0, length));
    }
  }
  return stems;
}

/** @param {PolicyDocument} document */
function compile(document) {
  if (document.policy_version !== PATH_POLICY_VERSION)
    throw new Error(`path policy is ${document.policy_version}, expected ${PATH_POLICY_VERSION}`);
  if (document.unicode.version !== UNICODE_VERSION)
    throw new Error(
      `path policy pins Unicode ${document.unicode.version}, the table is ${UNICODE_VERSION}`,
    );
  if (document.rules.at(-1)?.regex !== ".+")
    throw new Error("path policy must end with a catch-all rule, so every path is classified");
  for (const rule of document.rules)
    if ((rule.server_action === "allow") !== (rule.client_action === "include"))
      throw new Error(`path rule ${rule.id}: the server allows exactly what clients include`);
  const limits = document.path;
  const legacy = document.stored_manifest.legacy_rule_regexes;
  for (const id of Object.keys(legacy))
    if (!document.rules.some((rule) => rule.id === id))
      throw new Error(`path policy's stored_manifest names no rule ${id}`);
  const currentRules = document.rules.map((rule) => ({ rule, pattern: whole(rule.regex) }));
  const storedRules = document.rules.map((rule) => ({
    rule,
    pattern: whole(legacy[rule.id] ?? rule.regex),
  }));
  return {
    limits,
    invalidCharacter: new RegExp(
      `[\\x00-\\x1f\\x7f-\\x9f\\ud800-\\udfff${escaped(limits.forbidden_characters)}]`,
      "u",
    ),
    reservedSegment: whole(limits.reserved_segment_regex),
    shortNameShape: whole(limits.short_name_alias_shape),
    paths: {
      current: { rules: currentRules, stems: shortNameStems(limits.short_name_alias_names) },
      stored: {
        rules: storedRules,
        stems: shortNameStems(document.stored_manifest.legacy_short_name_alias_names),
      },
      localV4: { rules: storedRules, stems: new Set() },
    },
    canonicalRoots: new Map(
      limits.canonical_spelling_roots.map((root) => [comparisonKey(root), root]),
    ),
    rules: currentRules,
    prefilter: new Set(document.client_prefilter.names),
    symlinkPrefixes: document.client_symlinks.skip_prefixes,
  };
}

/** @type {ReturnType<typeof compile> | null} */
let compiled = null;
/** The policy, read and compiled when a path is first checked: an app that never syncs never reads it. */
const policy = () => (compiled ??= compile(readContract("path-policy.json")));

/** Every segment replaced by its comparison key. @param {string} path */
const foldedPath = (path) => path.split("/").map(comparisonKey).join("/");

/** @param {{ pattern: RegExp, rule: PathRule }} entry @param {string} folded @param {string} path */
const matches = ({ pattern, rule }, folded, path) =>
  pattern.test(folded) ||
  ((rule.id === "private-source" || rule.id === "unrecognized-hidden") &&
    pattern.test(privateSourceSpelling(path)));

/** The first rule matching a path's folded spelling. @param {string} path @returns {PathRule} */
export function classifyPath(path) {
  const folded = foldedPath(path);
  const found = policy().rules.find((entry) =>
    entry.rule.id === "portable-hidden-sources"
      ? entry.pattern.test(path) && entry.pattern.test(folded)
      : matches(entry, folded, path),
  );
  if (!found) throw new Error("the path policy's catch-all rule did not match");
  return found.rule;
}

/** @param {string} path */
export function isEligibleHiddenSourcePath(path) {
  try {
    validatePath(path, "current", true);
    return true;
  } catch (error) {
    if (!(error instanceof PathViolation)) throw error;
    return false;
  }
}

/** Checks 1 to 10 of the registry's `path.checks`: the ones about the string itself. @param {string} path @param {boolean} localV4 */
function checkSpelling(path, localV4) {
  const { limits, invalidCharacter } = policy();
  if (!path) throw new PathViolation("path_empty", path);
  if (invalidCharacter.test(path)) throw new PathViolation("path_invalid_character", path);
  if (!ASCII.test(path) && !allAssigned(path))
    throw new PathViolation("path_unassigned_code_point", path);
  if (nfc(path) !== path) throw new PathViolation("path_not_nfc", path);
  if (Buffer.byteLength(path, "utf8") > limits.max_path_bytes)
    throw new PathViolation("path_too_long", path);
  if (path.startsWith("/")) throw new PathViolation("path_not_relative", path);
  return checkSegments(path, limits, localV4);
}

/** @param {string} path @param {PolicyDocument["path"]} limits @param {boolean} localV4 */
function checkSegments(path, limits, localV4) {
  const segments = path.split("/");
  const bare = localV4 ? segments : segments.map(withoutIgnorable);
  if (bare.some((segment) => !segment)) throw new PathViolation("path_empty_segment", path);
  if (bare.some((segment) => segment === "." || segment === ".."))
    throw new PathViolation("path_dot_segment", path);
  if (segments.some((segment) => Buffer.byteLength(segment, "utf8") > limits.max_segment_bytes))
    throw new PathViolation("segment_too_long", path);
  if (segments.some((segment) => segment.endsWith(".") || segment.endsWith(" ")))
    throw new PathViolation("segment_trailing_dot_or_space", path);
  return segments;
}

/** Whether a segment's comparison key is a Windows 8.3 short name (GIT~1) of a name the policy refuses.
 * @param {string} key @param {ReadonlySet<string>} stems */
function isShortNameAlias(key, stems) {
  const stem = policy().shortNameShape.exec(key)?.[1];
  return stem !== undefined && stems.has(stem);
}

/** @typedef {"current" | "stored" | "localV4"} PathMode */

/** `path` unchanged when every client can store it and the policy lets it travel; throws PathViolation otherwise,
 * naming the first failing check in the registry's order. @param {string} path
 * @param {PathMode} [mode] @param {boolean} [includeHidden] */
export function validatePath(path, mode = "current", includeHidden = false) {
  const segments = checkSpelling(path, mode === "localV4");
  const keys = segments.map(mode === "localV4" ? v4ComparisonKey : comparisonKey);
  const { reservedSegment, canonicalRoots } = policy();
  const { rules, stems } = policy().paths[mode];
  if (keys.some((key) => reservedSegment.test(key))) throw new PathViolation("reserved_name", path);
  if (keys.some((key) => isShortNameAlias(key, stems)))
    throw new PathViolation("segment_short_name", path);
  const root = canonicalRoots.get(keys[0] ?? "");
  if (root !== undefined && segments[0] !== root)
    throw new PathViolation("reserved_path_alias", path);
  const folded = keys.join("/");
  const found = rules.find((entry) => matches(entry, folded, path));
  if (!found) throw new Error("the path policy's catch-all rule did not match");
  if (includeHidden && mode === "current") return validateHiddenSelection(path, found.rule);
  if (found.rule.server_action === "reject")
    throw new PathViolation("excluded_path", path, found.rule.id);
  if (!found.pattern.test(path))
    throw new PathViolation("reserved_path_alias", path, found.rule.id);
  return path;
}

/** @param {string} path @param {PathRule} rule */
function validateHiddenSelection(path, rule) {
  if (rule.server_action === "allow") throw new PathViolation("invalid_schema", path);
  if (rule.id !== "hidden-asset") throw new PathViolation("excluded_path", path, rule.id);
  const normalized = classifyPath(privateSourceSpelling(path));
  if (normalized.id !== "hidden-asset")
    throw new PathViolation("excluded_path", path, normalized.id);
  return path;
}

/** Refuses duplicates, and any two paths (or a path and a directory prefix) one filesystem would store as one name.
 * Each path must already pass validatePath. @param {readonly string[]} paths @param {(value: string) => string} [keyOf] */
export function checkInventoryPaths(paths, keyOf = comparisonKey) {
  const seen = { spellingByKey: new Map(), fileKeys: new Set(), directoryKeys: new Set() };
  for (const path of paths) {
    const segments = path.split("/");
    const keys = segments.map(keyOf);
    for (let depth = 1; depth <= segments.length; depth++)
      notePrefix(seen, path, {
        prefix: segments.slice(0, depth).join("/"),
        key: keys.slice(0, depth).join("/"),
        isFile: depth === segments.length,
      });
  }
}

/** One prefix of `path`, against every prefix before it, in the server's order of checks.
 * @param {{ spellingByKey: Map<string, string>, fileKeys: Set<string>, directoryKeys: Set<string> }} seen
 * @param {string} path @param {{ prefix: string, key: string, isFile: boolean }} at */
function notePrefix(seen, path, { prefix, key, isFile }) {
  const spelling = seen.spellingByKey.get(key) ?? prefix;
  seen.spellingByKey.set(key, spelling);
  if (isFile && seen.fileKeys.has(key))
    throw new PathViolation(spelling === prefix ? "duplicate_path" : "path_collision", path);
  if (spelling !== prefix) throw new PathViolation("path_collision", path);
  if (isFile ? seen.directoryKeys.has(key) : seen.fileKeys.has(key))
    throw new PathViolation("file_directory_collision", path);
  (isFile ? seen.fileKeys : seen.directoryKeys).add(key);
}

/** The registry's `client_prefilter`: a name (macOS's `Icon\r`) skipped before any path check. @param {string} name */
export const prefiltered = (name) => policy().prefilter.has(name);

/** The registry's `client_symlinks.skip_prefixes`: a link under `assets/podcast/` is skipped, never followed.
 * @param {string} path */
export const skippedSymlink = (path) =>
  policy().symlinkPrefixes.some((prefix) => foldedPath(path).startsWith(prefix));

/** The literal text a rule's regex starts with, up to its first metacharacter. @param {string} regex */
function literalPrefix(regex) {
  let text = "";
  for (let i = 0; i < regex.length; i++) {
    const char = regex[i] ?? "";
    if (char === "\\" && /[./-]/.test(regex[i + 1] ?? "")) text += regex[++i];
    else if (/[\w/-]/.test(char)) text += char;
    else break;
  }
  return text;
}

/** Whether no file under folder `dir` can be listed, so a capture need not open it: its first matching rule
 * excludes the folder and all below it, and no include rule before that one can reach inside. @param {string} dir */
export function excludedFolder(dir) {
  const folded = foldedPath(dir);
  const at = policy().rules.findIndex(
    ({ pattern, rule }) =>
      rule.id !== "unrecognized-hidden" &&
      rule.client_action !== "include" &&
      pattern.test(folded) &&
      pattern.test(`${folded}/x`),
  );
  if (at < 0) return false;
  return policy()
    .rules.slice(0, at)
    .every(({ rule }) => {
      if (rule.client_action !== "include") return true;
      const prefix = literalPrefix(rule.regex);
      return !(prefix.startsWith(`${folded}/`) || `${folded}/`.startsWith(prefix));
    });
}

/** Can an unconfirmed Begin replay this stored entry under today's rules?
 * @param {import("./types.js").ManifestFile} file */
export function canReplayUploadFile({ path, include_hidden }) {
  if (isPrivateSourcePath(path)) return false;
  try {
    validatePath(path, "current", include_hidden === true);
    return true;
  } catch (error) {
    if (error instanceof PathViolation) return false;
    throw error;
  }
}
