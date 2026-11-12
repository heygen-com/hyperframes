// @ts-check
// Validate snapshot paths in the order defined by the bundled portable-source-v4 policy.
import { readContract } from "./contract.mjs";
import { UNICODE_VERSION, allAssigned, comparisonKey, nfc } from "./unicode.mjs";

const PATH_POLICY_VERSION = "portable-source-v4";

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
  return {
    limits,
    invalidCharacter: new RegExp(
      `[\\x00-\\x1f\\x7f-\\x9f\\ud800-\\udfff${escaped(limits.forbidden_characters)}]`,
      "u",
    ),
    reservedSegment: whole(limits.reserved_segment_regex),
    canonicalRoots: new Map(
      limits.canonical_spelling_roots.map((root) => [comparisonKey(root), root]),
    ),
    rules: document.rules.map((rule) => ({ rule, pattern: whole(rule.regex) })),
    storedRules: document.rules.map((rule) => ({
      rule,
      pattern: whole(
        rule.id === "agent-client-state"
          ? document.stored_manifest.legacy_agent_state_regex
          : rule.regex,
      ),
    })),
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

/** The first rule matching a path's folded spelling. @param {string} path @returns {PathRule} */
export function classifyPath(path) {
  const folded = foldedPath(path);
  const found = policy().rules.find(({ pattern }) => pattern.test(folded));
  if (!found) throw new Error("the path policy's catch-all rule did not match");
  return found.rule;
}

/** Checks 1 to 10 of the registry's `path.checks`: the ones about the string itself. @param {string} path */
function checkSpelling(path) {
  const { limits, invalidCharacter } = policy();
  if (!path) throw new PathViolation("path_empty", path);
  if (invalidCharacter.test(path)) throw new PathViolation("path_invalid_character", path);
  if (!ASCII.test(path) && !allAssigned(path))
    throw new PathViolation("path_unassigned_code_point", path);
  if (nfc(path) !== path) throw new PathViolation("path_not_nfc", path);
  if (Buffer.byteLength(path, "utf8") > limits.max_path_bytes)
    throw new PathViolation("path_too_long", path);
  if (path.startsWith("/")) throw new PathViolation("path_not_relative", path);
  return checkSegments(path, limits);
}
/** @param {string} path @param {PolicyDocument["path"]} limits */
function checkSegments(path, limits) {
  const segments = path.split("/");
  if (segments.some((segment) => !segment)) throw new PathViolation("path_empty_segment", path);
  if (segments.some((segment) => segment === "." || segment === ".."))
    throw new PathViolation("path_dot_segment", path);
  if (segments.some((segment) => Buffer.byteLength(segment, "utf8") > limits.max_segment_bytes))
    throw new PathViolation("segment_too_long", path);
  if (segments.some((segment) => segment.endsWith(".") || segment.endsWith(" ")))
    throw new PathViolation("segment_trailing_dot_or_space", path);
  return segments;
}

/** `path` unchanged when every client can store it and the policy lets it travel; throws PathViolation otherwise,
 * naming the first failing check in the registry's order. @param {string} path
 * @param {boolean} [stored] */
export function validatePath(path, stored = false) {
  const segments = checkSpelling(path);
  const keys = segments.map(comparisonKey);
  const { reservedSegment, canonicalRoots } = policy();
  const rules = stored ? policy().storedRules : policy().rules;
  if (keys.some((key) => reservedSegment.test(key))) throw new PathViolation("reserved_name", path);
  const root = canonicalRoots.get(keys[0] ?? "");
  if (root !== undefined && segments[0] !== root)
    throw new PathViolation("reserved_path_alias", path);
  const folded = keys.join("/");
  const found = rules.find(({ pattern }) => pattern.test(folded));
  if (!found) throw new Error("the path policy's catch-all rule did not match");
  if (found.rule.server_action === "reject")
    throw new PathViolation("excluded_path", path, found.rule.id);
  if (!found.pattern.test(path))
    throw new PathViolation("reserved_path_alias", path, found.rule.id);
  return path;
}

/** Refuses duplicates, and any two paths (or a path and a directory prefix) one filesystem would store as one name.
 * Each path must already pass validatePath. @param {readonly string[]} paths */
export function checkInventoryPaths(paths) {
  const seen = { spellingByKey: new Map(), fileKeys: new Set(), directoryKeys: new Set() };
  for (const path of paths) {
    const segments = path.split("/");
    const keys = segments.map(comparisonKey);
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

/** The registry's `client_symlinks`: a link under `assets/podcast/` is skipped instead of failing the capture.
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
      rule.client_action !== "include" && pattern.test(folded) && pattern.test(`${folded}/x`),
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
