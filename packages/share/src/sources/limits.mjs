// @ts-check
// Check the workspace upload limits before hashing or sending files.

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** @typedef {import("./types.js").Limits} Limits @typedef {import("./types.js").LimitName} LimitName */

/** @type {Limits} */
export const V1_LIMITS = Object.freeze({
  maxFiles: 10_000,
  maxFileBytes: 5 * GIB,
  maxProjectBytes: 10 * GIB,
  maxManifestBytes: 8 * MIB,
});

/** How many of the biggest files an over-limit answer names. */
const NAMED = 10;

/** A manifest's file count, largest file, total and canonical size; every listed file counts, reused ones too.
 * @param {readonly { size: number }[]} files @param {number} manifestBytes */
const measure = (files, manifestBytes) => ({
  fileCount: files.length,
  largestFileBytes: files.reduce((most, file) => Math.max(most, file.size), 0),
  projectBytes: files.reduce((sum, file) => sum + file.size, 0),
  manifestBytes,
});

/** The first limit broken, in the server's fixed order (file count, file size, project size, manifest size), with
 * the biggest files first; null when the push fits. @param {readonly { path: string, size: number }[]} files
 * @param {number} manifestBytes @param {Limits} [limits] @returns {import("./types.js").OverLimit | null} */
export function overLimit(files, manifestBytes, limits = V1_LIMITS) {
  const size = measure(files, manifestBytes);
  /** @type {[LimitName, number, number][]} */
  const checks = [
    ["file_count", size.fileCount, limits.maxFiles],
    ["file_size", size.largestFileBytes, limits.maxFileBytes],
    ["project_size", size.projectBytes, limits.maxProjectBytes],
    ["manifest_size", size.manifestBytes, limits.maxManifestBytes],
  ];
  const broken = checks.find(([, actual, maximum]) => actual > maximum);
  if (!broken) return null;
  const biggest = [...files]
    .sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1))
    .slice(0, NAMED)
    .map(({ path, size: bytes }) => ({ path, size: bytes }));
  return { limit: broken[0], actual: broken[1], maximum: broken[2], biggest };
}
