// @ts-check
// Serialize snapshots to canonical UTF-8 bytes so clients and the server compute the same digest.
import { createHash } from "node:crypto";
import { v4ComparisonKey } from "./unicode.mjs";
import { PathViolation, checkInventoryPaths, validatePath } from "./pathPolicy.mjs";

const FORMAT_VERSION = 1;
export const ENTRYPOINT = "index.html";
const MAX_SAFE_SIZE = Number.MAX_SAFE_INTEGER;
const SHA256 = /^[0-9a-f]{64}$/;

/** @typedef {import("./types.js").ManifestFile} ManifestFile @typedef {import("./types.js").Violation} Violation
 * @typedef {import("./types.js").ManifestDocument} ManifestDocument @typedef {import("./types.js").Manifest} Manifest */

/** @typedef {import("./pathPolicy.mjs").PathMode} PathMode
 * @typedef {{mode: PathMode, pathErrors: Violation[]}} Validation */

/** Why a manifest was refused; `code` is the first violation's, in the server's order. */
export class ManifestInvalid extends Error {
  /** @param {Violation[]} violations */
  constructor(violations) {
    super(violations.map((violation) => violation.code).join(", "));
    this.name = "ManifestInvalid";
    this.violations = violations;
    this.code = violations[0]?.code ?? "invalid_schema";
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} error @returns {Violation} */
const violationOf = (error) => {
  if (!(error instanceof PathViolation)) throw error;
  return { code: error.code, path: error.path, ...(error.rule ? { rule: error.rule } : {}) };
};

/** A schema violation for each field `fields` does not name.
 * @param {Record<string, unknown>} value @param {readonly string[]} fields @param {Violation[]} out */
function unknownFields(value, fields, out) {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) out.push({ code: "invalid_schema" });
}

/** @param {unknown} raw @param {Violation[]} out @param {Validation} policy @returns {ManifestFile | null} */
function fileOf(raw, out, policy) {
  if (!isObject(raw)) return (out.push({ code: "invalid_schema" }), null);
  const before = out.length;
  const { path, sha256, size } = raw;
  if ("include_hidden" in raw && raw.include_hidden !== true) out.push({ code: "invalid_schema" });
  const marker = raw.include_hidden === true ? { include_hidden: /** @type {const} */ (true) } : {};
  if (typeof path !== "string") out.push({ code: "invalid_schema" });
  else {
    try {
      validatePath(path, policy.mode, marker.include_hidden);
    } catch (error) {
      policy.pathErrors.push(violationOf(error));
    }
  }
  checkBlob(sha256, size, out);
  unknownFields(raw, ["path", "sha256", "size", "include_hidden"], out);
  return out.length === before
    ? { path: String(path), sha256: String(sha256), size: Number(size), ...marker }
    : null;
}

/** @param {unknown} sha256 @param {unknown} size @param {Violation[]} out */
function checkBlob(sha256, size, out) {
  if (typeof sha256 !== "string") out.push({ code: "invalid_schema" });
  else if (!SHA256.test(sha256)) out.push({ code: "invalid_sha256" });
  if (typeof size !== "number" || !Number.isInteger(size)) out.push({ code: "invalid_schema" });
  else if (size < 0 || size > MAX_SAFE_SIZE) out.push({ code: "invalid_size" });
}

/** UTF-8 byte order, which is code point order; JavaScript's default sort compares UTF-16 units instead.
 * @param {ManifestFile} a @param {ManifestFile} b */
const byUtf8 = (a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8"));

/** The files in canonical order, or the inventory's first violation. @param {ManifestFile[]} files
 * @param {Violation[]} out @param {Validation} policy */
function canonicalInventory(files, out, policy) {
  const ordered = [...files].sort(byUtf8);
  /** @type {Map<string, number>} */
  const sizeByDigest = new Map();
  for (const file of ordered) {
    const size = sizeByDigest.get(file.sha256) ?? file.size;
    sizeByDigest.set(file.sha256, size);
    if (size !== file.size)
      return (out.push({ code: "inconsistent_digest_size", path: file.path }), null);
  }
  try {
    checkInventoryPaths(
      ordered.map((file) => file.path),
      policy.mode === "localV4" ? v4ComparisonKey : undefined,
    );
  } catch (error) {
    policy.pathErrors.push(violationOf(error));
  }
  return ordered;
}

/** @param {unknown} raw @param {Violation[]} out @param {Validation} policy */
function filesOf(raw, out, policy) {
  if (!Array.isArray(raw)) return (out.push({ code: "invalid_schema" }), null);
  const before = out.length;
  const files = raw.map((item) => fileOf(item, out, policy));
  if (out.length !== before) return null;
  return canonicalInventory(/** @type {ManifestFile[]} */ (files), out, policy);
}

/** The canonical bytes of a valid document. @param {ManifestDocument} document */
export function canonicalBytes(document) {
  const files = document.files
    .map(
      ({ path, sha256, size, include_hidden }) =>
        `{${include_hidden ? '"include_hidden":true,' : ""}"path":${JSON.stringify(path)},"sha256":${JSON.stringify(sha256)},"size":${size}}`,
    )
    .join(",");
  const text = `{"entrypoint":${JSON.stringify(document.entrypoint)},"files":[${files}],"format_version":${document.format_version}}`;
  return Buffer.from(text, "utf8");
}

/** Validates a manifest document as the server does; throws ManifestInvalid. @param {unknown} raw
 * @param {boolean} [stored] @returns {Manifest} */
export function parseManifest(raw, stored = false) {
  return readManifest(raw, stored ? "stored" : "current");
}

/** @param {Record<string, unknown>} raw @param {Violation[]} out */
function checkHeader(raw, out) {
  const { format_version: version, entrypoint } = raw;
  if (typeof version !== "number" || !Number.isInteger(version))
    out.push({ code: "invalid_schema" });
  else if (version !== FORMAT_VERSION) out.push({ code: "unsupported_format_version" });
  if (typeof entrypoint !== "string") out.push({ code: "invalid_schema" });
  else if (entrypoint !== ENTRYPOINT) out.push({ code: "invalid_entrypoint" });
}

/** @param {unknown} raw @param {PathMode} mode @param {Violation[]} [obsoletePaths] @returns {Manifest} */
function readManifest(raw, mode, obsoletePaths) {
  if (!isObject(raw)) throw new ManifestInvalid([{ code: "invalid_schema" }]);
  /** @type {Violation[]} */
  const out = [];
  checkHeader(raw, out);
  const files = filesOf(raw.files, out, { mode, pathErrors: obsoletePaths ?? out });
  unknownFields(raw, ["format_version", "entrypoint", "files"], out);
  if (out.length) throw new ManifestInvalid(out);
  const ordered = /** @type {ManifestFile[]} */ (files);
  if (!ordered.some((file) => file.path === ENTRYPOINT))
    throw new ManifestInvalid([{ code: "entrypoint_not_listed" }]);
  /** @type {ManifestDocument} */
  const document = { format_version: FORMAT_VERSION, entrypoint: ENTRYPOINT, files: ordered };
  const canonical = canonicalBytes(document);
  return { document, canonical, sha256: createHash("sha256").update(canonical).digest("hex") };
}

/** Stored manifest bytes, which must already be canonical so their hash is the snapshot's manifest_sha256.
 * @param {Uint8Array} body @returns {Manifest} */
export function parseCanonicalManifest(body) {
  let document;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body));
  } catch {
    throw new ManifestInvalid([{ code: "invalid_json" }]);
  }
  const manifest = parseManifest(document);
  if (!manifest.canonical.equals(Buffer.from(body)))
    throw new ManifestInvalid([{ code: "not_canonical" }]);
  return manifest;
}

/** A published snapshot or local base can retain v3 paths; its bytes and digest remain immutable.
 * @param {unknown} raw @returns {Manifest} */
export const parseStoredManifest = (raw) => parseManifest(raw, true);

/** Verify the local parent snapshot under the filename rules its writer supported. @param {unknown} raw */
export const localBaseDigest = (raw) => readManifest(raw, "localV4").sha256;

/** @param {{uploadId?: unknown, snapshotId?: unknown}} saved */
function confirmedUploadId(saved) {
  if (saved.uploadId === null && saved.snapshotId === null) return null;
  if (
    typeof saved.uploadId !== "string" ||
    !saved.uploadId ||
    typeof saved.snapshotId !== "string" ||
    !saved.snapshotId
  )
    throw new Error("Incomplete saved source upload identity.");
  return saved.uploadId;
}

/** Confirmed requests are reconciled by ID; only an unconfirmed Begin can need its manifest again.
 * @param {{manifest?: unknown, manifestSha256?: unknown, uploadId?: unknown, snapshotId?: unknown}} saved
 * @returns {{uploadId: string} | {manifest: Manifest} | null} */
export function readUploadIntent(saved) {
  const uploadId = confirmedUploadId(saved);
  /** @type {Violation[]} */
  const obsoletePaths = [];
  const manifest =
    uploadId === null
      ? readManifest(saved.manifest, "stored", obsoletePaths)
      : readManifest(saved.manifest, "localV4");
  if (manifest.sha256 !== saved.manifestSha256)
    throw new Error("Saved source upload manifest does not match its checksum.");
  if (uploadId !== null) return { uploadId };
  return obsoletePaths.length ? null : { manifest };
}
