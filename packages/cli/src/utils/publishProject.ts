import { basename, join, relative } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import AdmZip from "adm-zip";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

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

export async function publishProjectArchive(projectDir: string): Promise<PublishedProjectResponse> {
  const title = basename(projectDir);
  const archive = createPublishArchive(projectDir);
  const archiveBytes = new Uint8Array(archive.buffer.byteLength);
  archiveBytes.set(archive.buffer);
  const body = new FormData();
  body.set("title", title);
  body.set("file", new File([archiveBytes], `${title}.zip`, { type: "application/zip" }));
  const headers: Record<string, string> = {
    heygen_route: "canary",
  };

  const response = await fetch(`${getPublishApiBaseUrl()}/v1/hyperframes/projects/publish`, {
    method: "POST",
    body,
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  const payload = await response.json().catch(() => null);
  const message =
    typeof payload?.message === "string" ? payload.message : "Failed to publish project";
  if (!response.ok || !payload?.data) {
    throw new Error(message);
  }

  return {
    projectId: String(payload.data.project_id),
    title: String(payload.data.title),
    fileCount: Number(payload.data.file_count),
    url: String(payload.data.url),
    claimToken: String(payload.data.claim_token),
  };
}
