import { basename, join, relative } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import AdmZip from "adm-zip";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);
const PUBLISH_CONTENT_TYPE = "application/zip";
const PUBLISH_REQUEST_TIMEOUT_MS = 30_000;

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
  return {
    uploadUrl,
    uploadKey,
    contentType,
    uploadHeaders: getUploadHeaders(data, uploadUrl, contentType, archiveByteLength),
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

export function createPublishArchive(projectDir: string): PublishArchiveResult {
  const filePaths: string[] = [];
  collectProjectFiles(projectDir, projectDir, filePaths);
  if (!filePaths.includes("index.html")) {
    throw new Error("Project must include an index.html file at the root before publish.");
  }

  const archive = new AdmZip();
  for (const filePath of filePaths) {
    archive.addFile(filePath, readFileSync(join(projectDir, filePath)));
  }

  return {
    buffer: archive.toBuffer(),
    fileCount: filePaths.length,
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
): Promise<PublishedProjectResponse> {
  const body = new FormData();
  body.set("title", title);
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
    signal: AbortSignal.timeout(PUBLISH_REQUEST_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(PUBLISH_REQUEST_TIMEOUT_MS),
  });

  if (uploadResponse.status === 404 || uploadResponse.status === 405) {
    return null;
  }

  const uploadPayload = await readJson(uploadResponse);
  const stagedUpload = parseStagedUploadResponse(uploadPayload, archive.buffer.byteLength);
  if (!uploadResponse.ok || !stagedUpload) {
    throw new Error(await readErrorMessage(uploadResponse, "Failed to prepare project upload"));
  }

  const s3Response = await fetch(stagedUpload.uploadUrl, {
    method: "PUT",
    body: new Blob([archiveArrayBuffer(archive)], { type: stagedUpload.contentType }),
    headers: stagedUpload.uploadHeaders,
    signal: AbortSignal.timeout(PUBLISH_REQUEST_TIMEOUT_MS),
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
    }),
    headers: {
      "content-type": "application/json",
      heygen_route: "canary",
    },
    signal: AbortSignal.timeout(PUBLISH_REQUEST_TIMEOUT_MS),
  });

  const completePayload = await readJson(completeResponse);
  const publishedProject = parsePublishedProjectResponse(completePayload);
  if (!completeResponse.ok || !publishedProject) {
    throw new Error(await readErrorMessage(completeResponse, "Failed to publish project"));
  }

  return publishedProject;
}

export async function publishProjectArchive(projectDir: string): Promise<PublishedProjectResponse> {
  const title = basename(projectDir);
  const archive = createPublishArchive(projectDir);
  const apiBaseUrl = getPublishApiBaseUrl();
  const stagedResult = await publishProjectArchiveStaged(apiBaseUrl, title, archive);
  if (stagedResult) return stagedResult;
  return publishProjectArchiveDirect(apiBaseUrl, title, archive);
}
