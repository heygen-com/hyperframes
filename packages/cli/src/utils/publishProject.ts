import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { parseHTML } from "linkedom";
import AdmZip from "adm-zip";
import { CSS_URL_RE, isNonRelativeUrl, isPathInside } from "@hyperframes/core";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);
const PUBLISH_CONTENT_TYPE = "application/zip";
const PUBLISH_METADATA_TIMEOUT_MS = 30_000;
const PUBLISH_UPLOAD_MIN_TIMEOUT_MS = 120_000;
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
  const claimToken = stringField(data, "claim_token");
  const fileCount = data["file_count"];
  if (!projectId || !title || !url || !claimToken || typeof fileCount !== "number") {
    return null;
  }
  return {
    projectId,
    title,
    fileCount,
    url,
    claimToken,
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

export function uploadTimeoutMs(byteLength: number): number {
  return Math.max(
    PUBLISH_UPLOAD_MIN_TIMEOUT_MS,
    Math.ceil((byteLength / PUBLISH_UPLOAD_BYTES_PER_SECOND) * 1000),
  );
}

function shouldIgnoreSegment(segment: string): boolean {
  return segment.startsWith(".") || IGNORED_DIRS.has(segment) || IGNORED_FILES.has(segment);
}

function collectProjectFiles(rootDir: string, currentDir: string, paths: string[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (shouldIgnoreSegment(entry.name)) continue;
    const absolutePath = join(currentDir, entry.name);
    const relativePath = relative(rootDir, absolutePath).replaceAll("\\", "/");
    if (!relativePath) continue;

    if (entry.isDirectory()) {
      collectProjectFiles(rootDir, absolutePath, paths);
      continue;
    }

    if (!statSync(absolutePath).isFile()) continue;
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

function rewriteHtmlAttributes(
  ctx: ExternalAssetContext,
  document: Document,
  referrerAbsDir: string,
  entryPath: string,
): boolean {
  let modified = false;
  for (const el of document.querySelectorAll("[src], [href]")) {
    for (const attr of ["src", "href"]) {
      const val = (el.getAttribute(attr) || "").trim();
      if (!val) continue;
      const archivePath = tryResolveExternal(ctx, val, referrerAbsDir);
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
  const attrsChanged = rewriteHtmlAttributes(ctx, document, referrerAbsDir, entryPath);
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

export function createPublishArchive(projectDir: string): PublishArchiveResult {
  const absProjectDir = resolve(projectDir);
  const filePaths: string[] = [];
  collectProjectFiles(absProjectDir, absProjectDir, filePaths);
  if (!filePaths.includes("index.html")) {
    throw new Error("Project must include an index.html file at the root before publish.");
  }

  const fileContents = new Map<string, Buffer>();
  for (const filePath of filePaths) {
    fileContents.set(filePath, readFileSync(join(absProjectDir, filePath)));
  }

  localizeExternalAssets(absProjectDir, fileContents);

  const archive = new AdmZip();
  for (const [filePath, content] of fileContents) {
    archive.addFile(filePath, content);
  }

  return {
    buffer: archive.toBuffer(),
    fileCount: fileContents.size,
  };
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
): Promise<PublishedProjectResponse> {
  const body = new FormData();
  body.set("title", title);
  if (isPublic) body.set("is_public", "true");
  body.set(
    "file",
    new File([archiveArrayBuffer(archive)], `${title}.zip`, { type: PUBLISH_CONTENT_TYPE }),
  );
  const headers: Record<string, string> = {
    heygen_route: "canary",
  };

  const response = await fetch(`${apiBaseUrl}/v1/hyperframes/projects/publish`, {
    method: "POST",
    body,
    headers,
    signal: AbortSignal.timeout(uploadTimeoutMs(archive.buffer.byteLength)),
  });

  const payload = await readJson(response);
  const publishedProject = parsePublishedProjectResponse(payload);
  if (!response.ok || !publishedProject) {
    throw new Error(await readErrorMessage(response, "Failed to publish project"));
  }

  return publishedProject;
}

async function publishProjectArchiveStaged(
  apiBaseUrl: string,
  title: string,
  archive: PublishArchiveResult,
  isPublic: boolean,
): Promise<PublishedProjectResponse | null> {
  const fileName = `${title}.zip`;
  const uploadResponse = await fetch(`${apiBaseUrl}/v1/hyperframes/projects/publish/upload`, {
    method: "POST",
    body: JSON.stringify({
      file_name: fileName,
      content_type: PUBLISH_CONTENT_TYPE,
      content_length: archive.buffer.byteLength,
    }),
    headers: {
      "content-type": "application/json",
      heygen_route: "canary",
    },
    signal: AbortSignal.timeout(PUBLISH_METADATA_TIMEOUT_MS),
  });

  if (uploadResponse.status === 404 || uploadResponse.status === 405) {
    return null;
  }

  const uploadPayload = await readJson(uploadResponse);
  const stagedUpload = parseStagedUploadResponse(uploadPayload, archive.buffer.byteLength);
  if (!uploadResponse.ok || !stagedUpload) {
    throw new Error(await readErrorMessage(uploadResponse, "Failed to prepare project upload"));
  }

  const presignedUrlTtlMs = stagedUpload.expiresInSeconds * 1000 - PUBLISH_METADATA_TIMEOUT_MS;
  const s3Response = await fetch(stagedUpload.uploadUrl, {
    method: "PUT",
    body: new Blob([archiveArrayBuffer(archive)], { type: stagedUpload.contentType }),
    headers: stagedUpload.uploadHeaders,
    signal: AbortSignal.timeout(
      Math.min(uploadTimeoutMs(archive.buffer.byteLength), presignedUrlTtlMs),
    ),
  });
  if (!s3Response.ok) {
    throw new Error(await readErrorMessage(s3Response, "Failed to upload project archive"));
  }

  const completeResponse = await fetch(`${apiBaseUrl}/v1/hyperframes/projects/publish/complete`, {
    method: "POST",
    body: JSON.stringify({
      upload_key: stagedUpload.uploadKey,
      file_name: fileName,
      title,
      ...(isPublic ? { is_public: true } : {}),
    }),
    headers: {
      "content-type": "application/json",
      heygen_route: "canary",
    },
    signal: AbortSignal.timeout(uploadTimeoutMs(archive.buffer.byteLength)),
  });

  const completePayload = await readJson(completeResponse);
  const publishedProject = parsePublishedProjectResponse(completePayload);
  if (!completeResponse.ok || !publishedProject) {
    throw new Error(await readErrorMessage(completeResponse, "Failed to publish project"));
  }

  return publishedProject;
}

export interface PublishOptions {
  public?: boolean;
}

export async function publishProjectArchive(
  projectDir: string,
  opts: PublishOptions = {},
): Promise<PublishedProjectResponse> {
  const isPublic = opts.public === true;
  const title = basename(projectDir);
  const archive = createPublishArchive(projectDir);
  const apiBaseUrl = getPublishApiBaseUrl();
  const stagedResult = await publishProjectArchiveStaged(apiBaseUrl, title, archive, isPublic);
  if (stagedResult) return stagedResult;
  return publishProjectArchiveDirect(apiBaseUrl, title, archive, isPublic);
}
