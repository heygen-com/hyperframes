import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import AdmZip from "adm-zip";

const authMocks = vi.hoisted(() => ({
  tryResolveCredential: vi.fn(),
}));

vi.mock("../auth/index.js", () => ({
  tryResolveCredential: authMocks.tryResolveCredential,
}));

const linkMocks = vi.hoisted(() => ({
  writeProjectLink: vi.fn(),
}));

vi.mock("./projectLink.js", () => ({
  writeProjectLink: linkMocks.writeProjectLink,
}));

import {
  createPublishArchive,
  getPublishApiBaseUrl,
  localizeExternalAssets,
  publishProjectArchive,
  uploadTimeoutMs,
} from "./publishProject.js";

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-publish-"));
}

/** Writes an external asset and returns its path relative to `fromDir`, POSIX-slashed. */
function stageExternalAsset(
  extDir: string,
  fromDir: string,
  filename: string,
  content: string,
): string {
  writeFileSync(join(extDir, filename), content, "utf-8");
  return relative(fromDir, join(extDir, filename)).replaceAll("\\", "/");
}

/** A single-entry files map for `localizeExternalAssets`, keyed on index.html. */
function indexHtmlFiles(html: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set("index.html", Buffer.from(html, "utf-8"));
  return files;
}

/**
 * Stages one external asset in a fresh project/ext dir pair, builds the
 * files map from it via `buildFiles`, runs `localizeExternalAssets`, and
 * cleans up both dirs. Covers the single-external-asset test shape shared
 * by most `localizeExternalAssets` cases.
 */
function localizeSingleAsset(
  assetName: string,
  assetContent: string,
  buildFiles: (relToExt: string, projectDir: string) => Map<string, Buffer>,
): { count: number; files: Map<string, Buffer>; relToExt: string } {
  const projectDir = makeProjectDir();
  const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
  try {
    const relToExt = stageExternalAsset(extDir, projectDir, assetName, assetContent);
    const files = buildFiles(relToExt, projectDir);
    const count = localizeExternalAssets(projectDir, files);
    return { count, files, relToExt };
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(extDir, { recursive: true, force: true });
  }
}

/** Runs `localizeExternalAssets`, asserts nothing was rewritten, and returns the (unchanged) index.html. */
function expectNoLocalization(projectDir: string, files: Map<string, Buffer>): string {
  const count = localizeExternalAssets(projectDir, files);
  expect(count).toBe(0);
  return files.get("index.html")!.toString("utf-8");
}

/** Asserts a `localizeSingleAsset` result rewrote index.html exactly once, and returns it. */
function expectLocalizedHtml(result: {
  count: number;
  files: Map<string, Buffer>;
  relToExt: string;
}): string {
  expect(result.count).toBe(1);
  const rewrittenHtml = result.files.get("index.html")!.toString("utf-8");
  expect(rewrittenHtml).toContain("_ext/");
  expect(rewrittenHtml).not.toContain(result.relToExt);
  return rewrittenHtml;
}

/** The staged `/publish/upload` success response, overridable per test. */
function uploadResponse(overrides?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      data: {
        upload_url: "https://s3.example.com/upload",
        upload_key: "ephemeral_store/hyperframes/project_uploads/upload-1/demo.zip",
        upload_headers: { "content-type": "application/zip" },
        content_type: "application/zip",
        ...overrides,
      },
    }),
    { status: 200 },
  );
}

/** The `/publish/complete` (or legacy `/publish`) success response, overridable per test. */
function publishedResponse(overrides?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      data: {
        project_id: "hfp_123",
        title: "demo",
        file_count: 1,
        url: "https://hyperframes.dev/p/hfp_123",
        claim_token: "claim-token",
        ...overrides,
      },
    }),
    { status: 200 },
  );
}

/** Full staged flow: upload, S3 PUT, complete. */
function stagedFetch(completeData?: Record<string, unknown>, uploadData?: Record<string, unknown>) {
  return vi
    .fn()
    .mockResolvedValueOnce(uploadResponse(uploadData))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(publishedResponse(completeData));
}

/** Legacy multipart flow: staged upload 404s, falls back to direct publish. */
function directFetch(completeData?: Record<string, unknown>) {
  return vi
    .fn()
    .mockResolvedValueOnce(new Response("not found", { status: 404 }))
    .mockResolvedValueOnce(publishedResponse(completeData));
}

/** Asserts the Nth fetch call, always requiring an AbortSignal alongside the given init. */
function expectFetchCall(
  fetchMock: ReturnType<typeof vi.fn>,
  n: number,
  url: string,
  init: Record<string, unknown>,
): void {
  expect(fetchMock).toHaveBeenNthCalledWith(
    n,
    url,
    expect.objectContaining({ signal: expect.any(AbortSignal), ...init }),
  );
}

/** Resolves `tryResolveCredential` to a stubbed OAuth token for authenticated-request tests. */
function withOAuthCredential(): void {
  authMocks.tryResolveCredential.mockResolvedValue({
    type: "oauth",
    access_token: "test-token",
    source: "file_json",
    refreshable: false,
  });
}

/** Asserts the given fetch call carried the stubbed bearer token. */
function expectAuthorizedHeaders(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): void {
  expect(fetchMock.mock.calls[callIndex]![1].headers).toEqual(
    expect.objectContaining({ authorization: "Bearer test-token" }),
  );
}

/** Stubs an OAuth credential and fetch, then publishes a minimal project through `dir`. */
async function runAuthenticatedPublish(
  fetchMock: ReturnType<typeof vi.fn>,
  dir: string,
): Promise<void> {
  withOAuthCredential();
  vi.stubGlobal("fetch", fetchMock);
  writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
  await publishProjectArchive(dir);
}

describe("createPublishArchive", () => {
  it("packages the project and skips hidden files and node_modules", () => {
    const dir = makeProjectDir();
    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets/logo.svg"), "<svg />", "utf-8");
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".env"), "SECRET=1", "utf-8");
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules/ignored.js"), "console.log('ignore')", "utf-8");

      const archive = createPublishArchive(dir);

      expect(archive.fileCount).toBe(2);
      expect(archive.buffer.byteLength).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("localizeExternalAssets", () => {
  it("copies external src/href assets and rewrites HTML paths", () => {
    const result = localizeSingleAsset("logo.png", "PNG_DATA", (rel) =>
      indexHtmlFiles(`<html><body><img src="${rel}"></body></html>`),
    );
    expectLocalizedHtml(result);

    const extEntries = [...result.files.keys()].filter((k) => k.startsWith("_ext/"));
    expect(extEntries).toHaveLength(1);
    expect(result.files.get(extEntries[0]!)!.toString("utf-8")).toBe("PNG_DATA");
  });

  it("rewrites CSS url() in <style> blocks", () => {
    const result = localizeSingleAsset("bg.jpg", "JPEG_DATA", (rel) =>
      indexHtmlFiles(
        `<html><head><style>body { background: url("${rel}"); }</style></head></html>`,
      ),
    );

    const rewrittenHtml = expectLocalizedHtml(result);
    expect(rewrittenHtml).toContain("url(");
  });
});

describe("localizeExternalAssets", () => {
  it("rewrites url() in standalone CSS files", () => {
    const { count, files, relToExt } = localizeSingleAsset("font.woff2", "FONT_DATA", (rel) => {
      const files = indexHtmlFiles("<html></html>");
      files.set("styles.css", Buffer.from(`@font-face { src: url("${rel}"); }`, "utf-8"));
      return files;
    });

    expect(count).toBe(1);
    const rewrittenCss = files.get("styles.css")!.toString("utf-8");
    expect(rewrittenCss).toContain("_ext/");
    expect(rewrittenCss).not.toContain(relToExt);
  });

  it("leaves internal assets unchanged", () => {
    const projectDir = makeProjectDir();
    try {
      mkdirSync(join(projectDir, "assets"));
      writeFileSync(join(projectDir, "assets", "logo.svg"), "<svg/>", "utf-8");
      const files = indexHtmlFiles(`<html><body><img src="assets/logo.svg"></body></html>`);
      files.set("assets/logo.svg", Buffer.from("<svg/>", "utf-8"));

      const rewrittenHtml = expectNoLocalization(projectDir, files);

      expect(rewrittenHtml).toContain('src="assets/logo.svg"');
      expect([...files.keys()].filter((k) => k.startsWith("_ext/"))).toHaveLength(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("localizeExternalAssets", () => {
  it("leaves remote URLs unchanged", () => {
    const projectDir = makeProjectDir();
    try {
      const files = indexHtmlFiles(
        `<html><body><img src="https://cdn.example.com/logo.png"><video src="http://cdn.example.com/vid.mp4"></video></body></html>`,
      );

      const rewrittenHtml = expectNoLocalization(projectDir, files);

      expect(rewrittenHtml).toContain("https://cdn.example.com/logo.png");
      expect(rewrittenHtml).toContain("http://cdn.example.com/vid.mp4");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("no-op when no external assets exist", () => {
    const projectDir = makeProjectDir();
    try {
      const files = indexHtmlFiles(`<html><body><p>Hello</p></body></html>`);

      expectNoLocalization(projectDir, files);

      expect(files.size).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips references to non-existent external files", () => {
    const projectDir = makeProjectDir();
    try {
      const files = indexHtmlFiles(`<html><body><img src="../nonexistent/file.png"></body></html>`);

      const rewrittenHtml = expectNoLocalization(projectDir, files);

      expect(rewrittenHtml).toContain("../nonexistent/file.png");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("localizeExternalAssets", () => {
  it("deduplicates: same external asset referenced from multiple files", () => {
    const { count, files } = localizeSingleAsset("shared.png", "SHARED", (rel, projectDir) => {
      const files = indexHtmlFiles(`<html><body><img src="${rel}"></body></html>`);
      mkdirSync(join(projectDir, "compositions"));
      files.set(
        "compositions/scene.html",
        Buffer.from(`<html><body><img src="../${rel}"></body></html>`, "utf-8"),
      );
      return files;
    });

    expect(count).toBe(1);
    const extEntries = [...files.keys()].filter((k) => k.startsWith("_ext/"));
    expect(extEntries).toHaveLength(1);
  });

  it("handles sub-composition HTML with external refs", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      mkdirSync(join(projectDir, "compositions"));
      const relFromComps = stageExternalAsset(
        extDir,
        join(projectDir, "compositions"),
        "overlay.png",
        "OVERLAY",
      );

      const files = indexHtmlFiles("<html></html>");
      files.set(
        "compositions/scene.html",
        Buffer.from(`<html><body><img src="${relFromComps}"></body></html>`, "utf-8"),
      );

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const rewritten = files.get("compositions/scene.html")!.toString("utf-8");
      expect(rewritten).toContain("_ext/");
      expect(rewritten).not.toContain(relFromComps);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });
});

describe("localizeExternalAssets", () => {
  it("rewrites inline style url() references", () => {
    const result = localizeSingleAsset("bg.jpg", "JPEG_DATA", (rel) =>
      indexHtmlFiles(
        `<html><body><div style="background-image: url('${rel}')"></div></body></html>`,
      ),
    );

    expectLocalizedHtml(result);
  });

  it("createPublishArchive includes localized external assets", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      const relToExt = stageExternalAsset(extDir, projectDir, "video.mp4", "MP4_DATA");
      writeFileSync(
        join(projectDir, "index.html"),
        `<html><body><video src="${relToExt}"></video></body></html>`,
        "utf-8",
      );

      const archive = createPublishArchive(projectDir);

      expect(archive.fileCount).toBe(2);
      const zip = new AdmZip(archive.buffer);
      const entries = zip.getEntries().map((e) => e.entryName);
      expect(entries).toContain("index.html");
      expect(entries.some((e) => e.startsWith("_ext/") && e.endsWith("video.mp4"))).toBe(true);

      const indexHtml = zip.readAsText("index.html");
      expect(indexHtml).toContain("_ext/");
      expect(indexHtml).not.toContain(relToExt);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });
});

describe("uploadTimeoutMs", () => {
  it("returns the minimum timeout for small files", () => {
    expect(uploadTimeoutMs(0)).toBe(120_000);
    expect(uploadTimeoutMs(50 * 1024 * 1024)).toBe(120_000);
  });

  it("scales above the floor for large files", () => {
    expect(uploadTimeoutMs(64 * 1024 * 1024)).toBeGreaterThan(120_000);
    expect(uploadTimeoutMs(500 * 1024 * 1024)).toBeGreaterThan(900_000);
  });

  it("returns an integer", () => {
    expect(Number.isInteger(uploadTimeoutMs(123_456))).toBe(true);
  });
});

// Shared across every `publishProjectArchive` group below (file-scoped, not
// nested in a describe) so the reset logic isn't duplicated per group.
beforeEach(() => {
  authMocks.tryResolveCredential.mockReset().mockResolvedValue(null);
  linkMocks.writeProjectLink.mockReset();
  vi.stubEnv("HYPERFRAMES_PUBLISHED_PROJECTS_API_URL", "");
  vi.stubEnv("HEYGEN_API_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const jsonHeaders = { "content-type": "application/json", heygen_route: "canary" };
const signedStagedS3Url =
  "https://s3.example.com/upload?X-Amz-SignedHeaders=content-length;content-type;host;x-amz-server-side-encryption";

describe("publishProjectArchive", () => {
  it("uploads through the staged publish flow and returns the stable project URL", async () => {
    const dir = makeProjectDir();
    const fetchMock = stagedFetch(
      { file_count: 2 },
      {
        upload_url: signedStagedS3Url,
        upload_headers: {
          "content-type": "application/zip",
          "x-amz-server-side-encryption": "AES256",
        },
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
      writeFileSync(join(dir, "styles.css"), "body {}", "utf-8");

      const result = await publishProjectArchive(dir);

      expect(getPublishApiBaseUrl()).toBe("https://api2.heygen.com");
      expect(result).toMatchObject({
        projectId: "hfp_123",
        url: "https://hyperframes.dev/p/hfp_123",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expectFetchCall(
        fetchMock,
        1,
        "https://api2.heygen.com/v1/hyperframes/projects/publish/upload",
        {
          method: "POST",
          headers: jsonHeaders,
        },
      );
      expectFetchCall(fetchMock, 2, signedStagedS3Url, {
        method: "PUT",
        headers: {
          "content-length": expect.any(String),
          "content-type": "application/zip",
          "x-amz-server-side-encryption": "AES256",
        },
      });
      expectFetchCall(
        fetchMock,
        3,
        "https://api2.heygen.com/v1/hyperframes/projects/publish/complete",
        {
          method: "POST",
          headers: jsonHeaders,
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("publishProjectArchive", () => {
  it("authenticates staged metadata requests but not the presigned S3 upload", async () => {
    const dir = makeProjectDir();
    const fetchMock = stagedFetch();

    try {
      await runAuthenticatedPublish(fetchMock, dir);

      expect(authMocks.tryResolveCredential).toHaveBeenCalledTimes(1);
      expectAuthorizedHeaders(fetchMock, 0);
      expect(fetchMock.mock.calls[1]![1].headers).not.toHaveProperty("authorization");
      expectAuthorizedHeaders(fetchMock, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("authenticates the direct fallback request", async () => {
    const dir = makeProjectDir();
    const fetchMock = directFetch();

    try {
      await runAuthenticatedPublish(fetchMock, dir);

      expect(authMocks.tryResolveCredential).toHaveBeenCalledTimes(1);
      expectAuthorizedHeaders(fetchMock, 0);
      expectAuthorizedHeaders(fetchMock, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("publishProjectArchive", () => {
  it("falls back to the legacy multipart endpoint when staged publish is not deployed", async () => {
    const dir = makeProjectDir();
    const fetchMock = directFetch({ file_count: 2 });
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      const result = await publishProjectArchive(dir);

      expect(result.projectId).toBe("hfp_123");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expectFetchCall(fetchMock, 2, "https://api2.heygen.com/v1/hyperframes/projects/publish", {
        method: "POST",
        headers: { heygen_route: "canary" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends is_public in the staged complete body only when public is requested", async () => {
    const dir = makeProjectDir();

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      const publicFetch = stagedFetch();
      vi.stubGlobal("fetch", publicFetch);
      await publishProjectArchive(dir, { public: true });
      const publicCompleteBody = JSON.parse(publicFetch.mock.calls[2]![1].body);
      expect(publicCompleteBody.is_public).toBe(true);

      const defaultFetch = stagedFetch();
      vi.stubGlobal("fetch", defaultFetch);
      await publishProjectArchive(dir);
      const defaultCompleteBody = JSON.parse(defaultFetch.mock.calls[2]![1].body);
      expect(defaultCompleteBody).not.toHaveProperty("is_public");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("publishProjectArchive", () => {
  it("sends is_public in the direct multipart form only when public is requested", async () => {
    const dir = makeProjectDir();

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      const publicFetch = directFetch();
      vi.stubGlobal("fetch", publicFetch);
      await publishProjectArchive(dir, { public: true });
      const publicForm = publicFetch.mock.calls[1]![1].body as FormData;
      expect(publicForm.get("is_public")).toBe("true");

      const defaultFetch = directFetch();
      vi.stubGlobal("fetch", defaultFetch);
      await publishProjectArchive(dir);
      const defaultForm = defaultFetch.mock.calls[1]![1].body as FormData;
      expect(defaultForm.get("is_public")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not fall back to multipart when a staged S3 upload fails", async () => {
    const dir = makeProjectDir();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        uploadResponse({
          upload_headers: {
            "content-type": "application/zip",
            "x-amz-server-side-encryption": "AES256",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      await expect(publishProjectArchive(dir)).rejects.toThrow("Failed to upload project archive");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Staged flow returning an already-owned, already-claimed stable project. */
function ownedStagedFetch() {
  return stagedFetch({
    project_id: "hfp_stable",
    url: "https://hyperframes.dev/p/hfp_stable",
    claim_token: "",
    claimed: true,
  });
}

describe("publishProjectArchive", () => {
  it("sends and persists a stable project id when authenticated", async () => {
    withOAuthCredential();
    const dir = makeProjectDir();
    const fetchMock = ownedStagedFetch();
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      const result = await publishProjectArchive(dir, { projectId: "hfp_stable" });

      const completeBody = JSON.parse(fetchMock.mock.calls[2]![1].body);
      expect(completeBody.project_id).toBe("hfp_stable");
      // An owned re-publish returns claimed with no claim token to append.
      expect(result.claimed).toBe(true);
      expect(result.claimToken).toBe("");
      expect(linkMocks.writeProjectLink).toHaveBeenCalledWith(dir, {
        projectId: "hfp_stable",
        url: "https://hyperframes.dev/p/hfp_stable",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never sends a project id or persists a link when anonymous", async () => {
    // Default credential is null (anonymous).
    const dir = makeProjectDir();
    const fetchMock = ownedStagedFetch();
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      await publishProjectArchive(dir, { projectId: "hfp_stable" });

      const completeBody = JSON.parse(fetchMock.mock.calls[2]![1].body);
      expect(completeBody).not.toHaveProperty("project_id");
      expect(linkMocks.writeProjectLink).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function publishWithTeamSpace(authed: boolean) {
    // Set explicitly (not just for the authed case) so calling this twice in one test —
    // authed then anonymous — doesn't leak the credential mock across calls.
    if (authed) withOAuthCredential();
    else authMocks.tryResolveCredential.mockResolvedValue(null);
    const dir = makeProjectDir();
    const fetchMock = ownedStagedFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
      await publishProjectArchive(dir, { projectId: "hfp_stable", spaceId: "space-42" });
      return fetchMock;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("sends X-Space-Id only when authenticated (metadata requests, never the S3 PUT)", async () => {
    const authed = await publishWithTeamSpace(true);
    // Metadata calls (upload=0, complete=2) carry the team space header...
    expect(authed.mock.calls[0]![1].headers["x-space-id"]).toBe("space-42");
    expect(authed.mock.calls[2]![1].headers["x-space-id"]).toBe("space-42");
    // ...but the presigned S3 PUT (1) must NOT — extra headers break the signature.
    expect(authed.mock.calls[1]![1].headers).not.toHaveProperty("x-space-id");

    // Anonymous: the header is dropped entirely even if a space was requested.
    const anon = await publishWithTeamSpace(false);
    expect(anon.mock.calls[0]![1].headers).not.toHaveProperty("x-space-id");
    expect(anon.mock.calls[2]![1].headers).not.toHaveProperty("x-space-id");
  });
});
