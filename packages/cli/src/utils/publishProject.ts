import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { parseHTML } from "linkedom";
import AdmZip from "adm-zip";
import ignore, { type Ignore } from "ignore";
import { CSS_URL_RE, isNonRelativeUrl, isPathInside } from "@hyperframes/core";
import { buildAuthHeaders } from "../auth/client.js";
import { tryResolveCredential } from "../auth/index.js";
import { writeProjectLink } from "./projectLink.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);
const HYPERFRAMES_IGNORE_FILE = ".hyperframesignore";
const DEFAULT_PROJECT_IGNORE = ["/renders/", "/snapshots/"];
const PUBLISH_CONTENT_TYPE = "application/zip";
const PUBLISH_METADATA_TIMEOUT_MS = 30_000;
const PUBLISH_UPLOAD_MIN_TIMEOUT_MS = 120_000;
const PUBLISH_TRANSPORT_ATTEMPTS = 2;
const PUBLISH_RETRY_DELAY_MS = 200;
// Conservative floor — most connections are faster, but this prevents
// premature aborts on slow/unstable networks (hotel wifi, tethering).
const PUBLISH_UPLOAD_BYTES_PER_SECOND = 500_000;

export interface PublishArchiveResult {
  buffer: Buffer;
  fileCount: number;
}

export interface PublishedProjectResponse {
  projectId: string;
  title: string;
  fileCount: number;
  url: string;
  claimToken: string;
  /** True when the project is owned by the authenticated publisher (created-and-owned or updated in place). */
  claimed: boolean;
}

interface StagedUploadResponse {
  uploadUrl: string;
  uploadKey: string;
  contentType: string;
  uploadHeaders: Record<string, string>;
  expiresInSeconds: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataRecord(payload: unknown): JsonRecord | null {
  if (!isRecord(payload) || !isRecord(payload["data"])) return null;
  return payload["data"];
}

function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parsePublishedProjectResponse(payload: unknown): PublishedProjectResponse | null {
  const data = dataRecord(payload);
  if (!data) return null;
  const projectId = stringField(data, "project_id");
  const title = stringField(data, "title");
  const url = stringField(data, "url");
  const claimToken = stringField(data, "claim_token") ?? "";
  const claimed = data["claimed"] === true;
  const fileCount = data["file_count"];
  if (!projectId || !title || !url || typeof fileCount !== "number") {
    return null;
  }
  // Anonymous publishes must return a claim token; owned (claimed) ones need none.
  if (!claimed && !claimToken) {
    return null;
  }
  return {
    projectId,
    title,
    fileCount,
    url,
    claimToken,
    claimed,
  };
}

function parseStagedUploadResponse(
  payload: unknown,
  archiveByteLength: number,
): StagedUploadResponse | null {
  const data = dataRecord(payload);
  if (!data) return null;
  const uploadUrl = stringField(data, "upload_url");
  const uploadKey = stringField(data, "upload_key");
  const contentType = stringField(data, "content_type") || PUBLISH_CONTENT_TYPE;
  if (!uploadUrl || !uploadKey) return null;
  const rawExpires = data["expires_in_seconds"];
  const expiresInSeconds = typeof rawExpires === "number" && rawExpires > 0 ? rawExpires : 1800;
  return {
    uploadUrl,
    uploadKey,
    contentType,
    uploadHeaders: getUploadHeaders(data, uploadUrl, contentType, archiveByteLength),
    expiresInSeconds,
  };
}

function getUploadHeaders(
  data: JsonRecord,
  uploadUrl: string,
  contentType: string,
  archiveByteLength: number,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const uploadHeaders = data["upload_headers"];
  if (isRecord(uploadHeaders)) {
    for (const [key, value] of Object.entries(uploadHeaders)) {
      if (typeof value === "string" && key.trim()) {
        headers[key] = value;
      }
    }
  }

  if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = contentType;
  }

  const signedHeaders = new URL(uploadUrl).searchParams.get("X-Amz-SignedHeaders");
  if (
    signedHeaders?.split(";").includes("x-amz-server-side-encryption") &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "x-amz-server-side-encryption")
  ) {
    headers["x-amz-server-side-encryption"] = "AES256";
  }
  if (
    signedHeaders?.split(";").includes("content-length") &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")
  ) {
    headers["content-length"] = String(archiveByteLength);
  }

  return headers;
}

async function readJson(response: Response): Promise<unknown> {
  return response
    .clone()
    .json()
    .catch(() => null);
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await readJson(response);
    if (isRecord(payload) && typeof payload["message"] === "string") {
      return payload["message"];
    }
  }

  if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
    return "Publish upload was blocked before reaching HyperFrames. Please retry after staged uploads are available.";
  }

  const text = await response.text().catch(() => "");
  return text.trim() ? `${fallback}: ${text.trim().slice(0, 180)}` : fallback;
}

function systemErrorMetadata(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const metadata: string[] = [];
  if (typeof value["code"] === "string") metadata.push(value["code"]);
  if (typeof value["syscall"] === "string") metadata.push(`syscall=${value["syscall"]}`);
  if (typeof value["errno"] === "string" || typeof value["errno"] === "number") {
    metadata.push(`errno=${value["errno"]}`);
  }
  return metadata;
}

function redactUrlQuery(message: string): string {
  return message.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gu, "$1?[redacted]");
}

function proxySupportHint(): string {
  const proxyConfigured = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].some((key) =>
    Boolean(process.env[key]?.trim()),
  );
  const proxyEnabled =
    process.env["NODE_USE_ENV_PROXY"] === "1" ||
    process.execArgv.includes("--use-env-proxy") ||
    process.env["NODE_OPTIONS"]?.split(/\s+/u).includes("--use-env-proxy") === true;
  if (!proxyConfigured || proxyEnabled) return "";
  return (
    ". Proxy variables are set but ignored by Node fetch; if this network requires them, retry with " +
    "NODE_USE_ENV_PROXY=1 (Node 22.21+)"
  );
}

function describeFetchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : "";
  const metadata = [...systemErrorMetadata(cause), ...systemErrorMetadata(error)].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const distinctCauseMessage = causeMessage && causeMessage !== message ? causeMessage : "";
  const detail = [metadata.join(", "), distinctCauseMessage].filter(Boolean).join(": ");
  return `${redactUrlQuery(message)}${detail ? ` (${redactUrlQuery(detail)})` : ""}${proxySupportHint()}`;
}

function isRequestTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function waitBeforePublishRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PUBLISH_RETRY_DELAY_MS));
}

async function fetchForPublish(
  input: string,
  createInit: () => RequestInit,
  failureStage: string,
  attempts = 1,
): Promise<Response> {
  if (attempts < 1) throw new RangeError("Publish fetch attempts must be at least 1");
  let lastError: unknown;
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      return await fetch(input, createInit());
    } catch (error) {
      lastError = error;
      if (isRequestTimeout(error) || attempt === attempts) break;
      await waitBeforePublishRetry();
    }
  }
  const attemptDetail = attemptsMade > 1 ? ` after ${attemptsMade} attempts` : "";
  throw new Error(`${failureStage}${attemptDetail}: ${describeFetchFailure(lastError)}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

export function uploadTimeoutMs(byteLength: number): number {
  return Math.max(
    PUBLISH_UPLOAD_MIN_TIMEOUT_MS,
    Math.ceil((byteLength / PUBLISH_UPLOAD_BYTES_PER_SECOND) * 1000),
  );
}

function shouldIgnoreSegment(segment: string): boolean {
  return segment.startsWith(".") || IGNORED_DIRS.has(segment) || IGNORED_FILES.has(segment);
}

function createProjectIgnore(rootDir: string): Ignore {
  const matcher = ignore().add(DEFAULT_PROJECT_IGNORE);
  const ignorePath = join(rootDir, HYPERFRAMES_IGNORE_FILE);
  if (existsSync(ignorePath)) {
    matcher.add(readFileSync(ignorePath, "utf-8"));
  }
  return matcher;
}

function collectProjectFiles(
  rootDir: string,
  currentDir: string,
  paths: string[],
  matcher: Ignore,
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (shouldIgnoreSegment(entry.name)) continue;
    const absolutePath = join(currentDir, entry.name);
    const relativePath = relative(rootDir, absolutePath).replaceAll("\\", "/");
    if (!relativePath) continue;

    if (entry.isDirectory()) {
      if (matcher.ignores(`${relativePath}/`)) continue;
      collectProjectFiles(rootDir, absolutePath, paths, matcher);
      continue;
    }

    if (!statSync(absolutePath).isFile()) continue;
    if (matcher.ignores(relativePath)) continue;
    paths.push(relativePath);
  }
}

const EXT_ASSETS_PREFIX = "_ext";

interface ExternalAssetContext {
  absProjectDir: string;
  fileContents: Map<string, Buffer>;
  externalMap: Map<string, string>;
  usedArchivePaths: Set<string>;
}

function addExternalAsset(ctx: ExternalAssetContext, absPath: string): string {
  const existing = ctx.externalMap.get(absPath);
  if (existing) return existing;

  const rel = relative(ctx.absProjectDir, absPath).replaceAll("\\", "/");
  const stripped = rel.replace(/^(?:\.\.\/)+/, "");
  let archivePath = `${EXT_ASSETS_PREFIX}/${stripped}`;

  if (ctx.usedArchivePaths.has(archivePath)) {
    const ext = posix.extname(archivePath);
    const base = archivePath.slice(0, archivePath.length - ext.length);
    let i = 2;
    while (ctx.usedArchivePaths.has(`${base}_${i}${ext}`)) i++;
    archivePath = `${base}_${i}${ext}`;
  }

  ctx.fileContents.set(archivePath, readFileSync(absPath));
  ctx.externalMap.set(absPath, archivePath);
  ctx.usedArchivePaths.add(archivePath);
  return archivePath;
}

function tryResolveExternal(
  ctx: ExternalAssetContext,
  rawPath: string,
  referrerAbsDir: string,
): string | null {
  if (isNonRelativeUrl(rawPath)) return null;
  const absPath = resolve(referrerAbsDir, rawPath);
  if (isPathInside(absPath, ctx.absProjectDir)) return null;
  try {
    if (!existsSync(absPath) || !statSync(absPath).isFile()) return null;
  } catch {
    return null;
  }
  return addExternalAsset(ctx, absPath);
}

function rewriteCssUrls(
  ctx: ExternalAssetContext,
  css: string,
  referrerAbsDir: string,
  entryPath: string,
): { css: string; modified: boolean } {
  let modified = false;
  const rewritten = css.replace(CSS_URL_RE, (full, quote: string, rawUrl: string) => {
    const archivePath = tryResolveExternal(ctx, (rawUrl || "").trim(), referrerAbsDir);
    if (!archivePath) return full;
    modified = true;
    return `url(${quote || ""}${posix.relative(posix.dirname(entryPath), archivePath)}${quote || ""})`;
  });
  return { css: rewritten, modified };
}

/** Resolves a raw attribute value (plus the referrer's absolute directory) to
 * the archive path it should point at, or `null` to leave it untouched. */
export type HtmlAttributeResolver = (rawValue: string, referrerAbsDir: string) => string | null;

interface RewriteHtmlAttributesOptions {
  /** Attributes to inspect (default: src + href, matching the external-asset
   * localization use case below). */
  attrs?: string[];
  /** CSS selector narrowing which elements are inspected (default: derived
   * from `attrs`, e.g. `"[src], [href]"`). Callers that only care about one
   * tag (e.g. `<video>`) pass something like `"video[src]"`. */
  selector?: string;
}

/**
 * Walk every element matching `selector` (default: anything with `src`/
 * `href`) and rewrite the given `attrs` whose value `resolveTarget` maps to an
 * archive path. Shared by `localizeHtmlEntry` below (external-asset
 * localization) and `publishProxyBake.ts` (proxy baking only rewrites
 * `<video src>`), so the rewrite mechanics (attribute walk + entry-relative
 * path rewrite) live in one place while each caller supplies its own
 * resolution rule.
 */
export function rewriteHtmlAttributes(
  document: Document,
  referrerAbsDir: string,
  entryPath: string,
  resolveTarget: HtmlAttributeResolver,
  options: RewriteHtmlAttributesOptions = {},
): boolean {
  const attrs = options.attrs ?? ["src", "href"];
  const selector = options.selector ?? attrs.map((attr) => `[${attr}]`).join(", ");
  let modified = false;
  for (const el of document.querySelectorAll(selector)) {
    for (const attr of attrs) {
      const val = (el.getAttribute(attr) || "").trim();
      if (!val) continue;
      const archivePath = resolveTarget(val, referrerAbsDir);
      if (!archivePath) continue;
      el.setAttribute(attr, posix.relative(posix.dirname(entryPath), archivePath));
      modified = true;
    }
  }
  return modified;
}

function rewriteStyleBlocks(
  ctx: ExternalAssetContext,
  document: Document,
  referrerAbsDir: string,
  entryPath: string,
): boolean {
  let modified = false;
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent || "";
    if (!css.includes("url(")) continue;
    const result = rewriteCssUrls(ctx, css, referrerAbsDir, entryPath);
    if (result.modified) {
      styleEl.textContent = result.css;
      modified = true;
    }
  }
  for (const el of document.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") || "";
    if (!style.includes("url(")) continue;
    const result = rewriteCssUrls(ctx, style, referrerAbsDir, entryPath);
    if (result.modified) {
      el.setAttribute("style", result.css);
      modified = true;
    }
  }
  return modified;
}

function localizeHtmlEntry(ctx: ExternalAssetContext, entryPath: string, content: Buffer): void {
  const referrerAbsDir = resolve(ctx.absProjectDir, dirname(entryPath));
  const { document } = parseHTML(content.toString("utf-8"));
  const attrsChanged = rewriteHtmlAttributes(document, referrerAbsDir, entryPath, (val, dir) =>
    tryResolveExternal(ctx, val, dir),
  );
  const stylesChanged = rewriteStyleBlocks(ctx, document, referrerAbsDir, entryPath);
  if (attrsChanged || stylesChanged) {
    ctx.fileContents.set(entryPath, Buffer.from(document.toString(), "utf-8"));
  }
}

function localizeCssEntry(ctx: ExternalAssetContext, entryPath: string, content: Buffer): void {
  const referrerAbsDir = resolve(ctx.absProjectDir, dirname(entryPath));
  const css = content.toString("utf-8");
  if (!css.includes("url(")) return;
  const result = rewriteCssUrls(ctx, css, referrerAbsDir, entryPath);
  if (result.modified) {
    ctx.fileContents.set(entryPath, Buffer.from(result.css, "utf-8"));
  }
}

/**
 * Scan HTML and CSS files for asset references that resolve outside the
 * project directory. Copy those files into the archive under `_ext/` and
 * rewrite the references so the published project is self-contained.
 */
export function localizeExternalAssets(
  absProjectDir: string,
  fileContents: Map<string, Buffer>,
): number {
  const ctx: ExternalAssetContext = {
    absProjectDir,
    fileContents,
    externalMap: new Map(),
    usedArchivePaths: new Set(),
  };

  for (const [entryPath, content] of [...fileContents.entries()]) {
    if (entryPath.startsWith(EXT_ASSETS_PREFIX + "/")) continue;
    if (entryPath.endsWith(".html") || entryPath.endsWith(".htm")) {
      localizeHtmlEntry(ctx, entryPath, content);
    } else if (entryPath.endsWith(".css")) {
      localizeCssEntry(ctx, entryPath, content);
    }
  }

  return ctx.externalMap.size;
}

/**
 * Walk the project dir, read every non-ignored file, and localize external
 * (out-of-project) asset references. Returns the in-memory archive file map —
 * the seam `publish.ts` hooks a proxy-baking transform into (U6) between this
 * and `zipPublishFileMap` below. `cloud render` never sees this seam: it
 * keeps calling `createPublishArchive` directly.
 */
export function buildPublishFileMap(projectDir: string): Map<string, Buffer> {
  const absProjectDir = resolve(projectDir);
  const filePaths: string[] = [];
  collectProjectFiles(absProjectDir, absProjectDir, filePaths, createProjectIgnore(absProjectDir));
  if (!filePaths.includes("index.html")) {
    throw new Error(
      "Project archive must include index.html at the root. Check that .hyperframesignore does not exclude it.",
    );
  }

  const fileContents = new Map<string, Buffer>();
  for (const filePath of filePaths) {
    fileContents.set(filePath, readFileSync(join(absProjectDir, filePath)));
  }

  localizeExternalAssets(absProjectDir, fileContents);
  return fileContents;
}

/** Zip an in-memory archive file map (from `buildPublishFileMap`, optionally
 * transformed in between, e.g. by proxy baking) into the final archive buffer. */
/**
 * Fixed entry timestamp, so the same files always zip to the same bytes.
 *
 * adm-zip stamps every entry with `new Date()` as it is constructed, and a ZIP
 * timestamp has two-second granularity — so archiving identical content twice
 * produced different bytes whenever the two runs landed either side of a
 * two-second boundary. That makes the archive's digest a function of the clock
 * rather than of its contents, which is the opposite of what a
 * content-addressed artifact needs.
 *
 * Built from local components on purpose: `fromDate2DOS` reads `getFullYear`,
 * `getMonth`, `getHours` and friends, so a fixed *instant* would still encode
 * differently in different timezones. Fixing the wall-clock reading is what
 * makes the bytes match across machines. 1980-01-01 is the earliest a DOS
 * timestamp can represent.
 */
const ARCHIVE_ENTRY_TIME = new Date(1980, 0, 1, 0, 0, 0, 0);

export function zipPublishFileMap(fileContents: Map<string, Buffer>): PublishArchiveResult {
  const archive = new AdmZip();
  for (const [filePath, content] of fileContents) {
    archive.addFile(filePath, content);
  }
  for (const entry of archive.getEntries()) {
    entry.header.time = ARCHIVE_ENTRY_TIME;
  }

  return {
    buffer: archive.toBuffer(),
    fileCount: fileContents.size,
  };
}

/**
 * Thin composition of `buildPublishFileMap` + `zipPublishFileMap` — signature
 * and behavior UNCHANGED from before the U6 split. `cloud render` composes the
 * same two functions without an intermediate transform and must stay
 * byte-identical (never see baked proxies); only `publish.ts` inserts a baking
 * transform between them.
 */
export function createPublishArchive(projectDir: string): PublishArchiveResult {
  return zipPublishFileMap(buildPublishFileMap(projectDir));
}

export function getPublishApiBaseUrl(): string {
  return (
    process.env["HYPERFRAMES_PUBLISHED_PROJECTS_API_URL"] ||
    process.env["HEYGEN_API_URL"] ||
    "https://api2.heygen.com"
  ).replace(/\/$/, "");
}

function archiveArrayBuffer(archive: PublishArchiveResult): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(archive.buffer.byteLength);
  new Uint8Array(arrayBuffer).set(archive.buffer);
  return arrayBuffer;
}

async function publishProjectArchiveDirect(
  apiBaseUrl: string,
  title: string,
  archive: PublishArchiveResult,
  isPublic: boolean,
  authHeaders: Record<string, string>,
  projectId: string | undefined,
): Promise<PublishedProjectResponse> {
  const body = new FormData();
  body.set("title", title);
  if (isPublic) body.set("is_public", "true");
  if (projectId) body.set("project_id", projectId);
  body.set(
    "file",
    new File([archiveArrayBuffer(archive)], `${title}.zip`, { type: PUBLISH_CONTENT_TYPE }),
  );
  const headers: Record<string, string> = { ...authHeaders };

  const response = await fetchForPublish(
    `${apiBaseUrl}/v1/hyperframes/projects/publish`,
    () => ({
      method: "POST",
      body,
      headers,
      signal: AbortSignal.timeout(uploadTimeoutMs(archive.buffer.byteLength)),
    }),
    "Failed to publish project",
  );

  const payload = await readJson(response);
  const publishedProject = parsePublishedProjectResponse(payload);
  if (!response.ok || !publishedProject) {
    throw new Error(await readErrorMessage(response, "Failed to publish project"));
  }

  return publishedProject;
}

async function uploadArchiveToPresignedUrl(
  stagedUpload: StagedUploadResponse,
  archive: PublishArchiveResult,
): Promise<void> {
  const presignedUrlTtlMs = stagedUpload.expiresInSeconds * 1000 - PUBLISH_METADATA_TIMEOUT_MS;
  const s3Response = await fetchForPublish(
    stagedUpload.uploadUrl,
    () => ({
      method: "PUT",
      body: new Blob([archiveArrayBuffer(archive)], { type: stagedUpload.contentType }),
      headers: stagedUpload.uploadHeaders,
      signal: AbortSignal.timeout(
        Math.min(uploadTimeoutMs(archive.buffer.byteLength), presignedUrlTtlMs),
      ),
    }),
    "Failed to upload project archive",
    PUBLISH_TRANSPORT_ATTEMPTS,
  );
  if (!s3Response.ok) {
    throw new Error(await readErrorMessage(s3Response, "Failed to upload project archive"));
  }
}

async function publishProjectArchiveStaged(
  apiBaseUrl: string,
  title: string,
  archive: PublishArchiveResult,
  isPublic: boolean,
  authHeaders: Record<string, string>,
  projectId: string | undefined,
): Promise<PublishedProjectResponse | null> {
  const fileName = `${title}.zip`;
  const uploadResponse = await fetchForPublish(
    `${apiBaseUrl}/v1/hyperframes/projects/publish/upload`,
    () => ({
      method: "POST",
      body: JSON.stringify({
        file_name: fileName,
        content_type: PUBLISH_CONTENT_TYPE,
        content_length: archive.buffer.byteLength,
      }),
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(PUBLISH_METADATA_TIMEOUT_MS),
    }),
    "Failed to prepare project upload",
    PUBLISH_TRANSPORT_ATTEMPTS,
  );

  if (uploadResponse.status === 404 || uploadResponse.status === 405) {
    return null;
  }

  const uploadPayload = await readJson(uploadResponse);
  const stagedUpload = parseStagedUploadResponse(uploadPayload, archive.buffer.byteLength);
  if (!uploadResponse.ok || !stagedUpload) {
    throw new Error(await readErrorMessage(uploadResponse, "Failed to prepare project upload"));
  }

  await uploadArchiveToPresignedUrl(stagedUpload, archive);

  const completeResponse = await fetchForPublish(
    `${apiBaseUrl}/v1/hyperframes/projects/publish/complete`,
    () => ({
      method: "POST",
      body: JSON.stringify({
        upload_key: stagedUpload.uploadKey,
        file_name: fileName,
        title,
        ...(isPublic ? { is_public: true } : {}),
        ...(projectId ? { project_id: projectId } : {}),
      }),
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(uploadTimeoutMs(archive.buffer.byteLength)),
    }),
    "Failed to finalize project publish",
  );

  const completePayload = await readJson(completeResponse);
  const publishedProject = parsePublishedProjectResponse(completePayload);
  if (!completeResponse.ok || !publishedProject) {
    throw new Error(await readErrorMessage(completeResponse, "Failed to publish project"));
  }

  return publishedProject;
}

export interface PublishOptions {
  public?: boolean;
  /** Stable project id to update in place. Only sent when authenticated. */
  projectId?: string;
  /** Shared team space id, sent as X-Space-Id so team members converge. Only when authenticated. */
  spaceId?: string;
  /**
   * Pre-built archive to upload instead of building one fresh from
   * `projectDir` via `createPublishArchive`. `publish.ts` passes this so it
   * can bake proxies into the file map between `buildPublishFileMap` and
   * `zipPublishFileMap` (U6); callers that omit it (e.g. `feedback`'s
   * minimal-repro publish) keep today's behavior unchanged.
   */
  archive?: PublishArchiveResult;
}

export async function publishProjectArchive(
  projectDir: string,
  opts: PublishOptions = {},
): Promise<PublishedProjectResponse> {
  const isPublic = opts.public === true;
  const title = basename(projectDir);
  const archive = opts.archive ?? createPublishArchive(projectDir);
  const apiBaseUrl = getPublishApiBaseUrl();
  const credential = await tryResolveCredential();
  const authHeaders = credential ? buildAuthHeaders(credential) : {};
  // A stable id / team space only mean something to an authenticated owner — the server
  // ignores them otherwise, and anonymous publishes always mint a fresh project.
  const projectId = credential ? opts.projectId : undefined;
  const spaceId = credential ? opts.spaceId : undefined;
  // X-Space-Id rides with the auth headers on the metadata requests only (never the
  // presigned S3 PUT), so the server resolves the shared team space instead of the personal one.
  const metadataHeaders = spaceId ? { ...authHeaders, "x-space-id": spaceId } : authHeaders;
  const result =
    (await publishProjectArchiveStaged(
      apiBaseUrl,
      title,
      archive,
      isPublic,
      metadataHeaders,
      projectId,
    )) ??
    (await publishProjectArchiveDirect(
      apiBaseUrl,
      title,
      archive,
      isPublic,
      metadataHeaders,
      projectId,
    ));
  // Remember the server's id + url so the next publish of this directory updates in place.
  if (credential) {
    writeProjectLink(projectDir, { projectId: result.projectId, url: result.url });
  }
  return result;
}
