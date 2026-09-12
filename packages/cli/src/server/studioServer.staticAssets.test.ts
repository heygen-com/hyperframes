import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer, isContentHashedAsset, type StudioServer } from "./studioServer.js";

/**
 * Cache and transfer policy for the studio bundle. A content-hashed URL can
 * never serve different bytes, so it is safe to keep forever; everything else
 * the same routes serve (public/ files, the HTML shell) changes under a
 * stable URL and must keep revalidating.
 */

const hooks = vi.hoisted(() => ({ studioDir: "" }));

// The bundle directory is resolved from __dirname at server construction, so
// point that one `resolve(<...>/server, "studio")` call at a temp tree.
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return {
    ...actual,
    resolve: (...parts: string[]) =>
      hooks.studioDir && parts.length === 2 && parts[0]?.endsWith("server") && parts[1] === "studio"
        ? hooks.studioDir
        : actual.resolve(...parts),
  };
});

const HASHED_BUNDLE = "index-BRr1JoHX.js";
// Large enough to clear hono's 1KB compression threshold.
const BUNDLE_BYTES = `export const studio = ${JSON.stringify("x".repeat(4096))};\n`;

let root: string;
let server: StudioServer;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "hf-studio-assets-"));
  hooks.studioDir = path.join(root, "studio");
  const projectDir = path.join(root, "project");
  fs.mkdirSync(projectDir);
  fs.mkdirSync(path.join(hooks.studioDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(hooks.studioDir, "assets", HASHED_BUNDLE), BUNDLE_BYTES);
  fs.writeFileSync(path.join(hooks.studioDir, "assets", "unhashed.js"), BUNDLE_BYTES);
  fs.writeFileSync(
    path.join(hooks.studioDir, "index.html"),
    "<html><head></head><body>Studio</body></html>",
  );
  server = createStudioServer({ projectDir });
});

afterEach(() => {
  server.watcher.close();
  fs.rmSync(root, { recursive: true, force: true });
  hooks.studioDir = "";
});

describe("studio bundle cache policy", () => {
  it("serves a content-hashed asset as immutable", async () => {
    const response = await server.app.request(`/assets/${HASHED_BUNDLE}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("keeps an unhashed asset revalidating", async () => {
    const response = await server.app.request("/assets/unhashed.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the HTML shell revalidating, since it names the hashed bundle", async () => {
    const response = await server.app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  // The first four are real filenames from `bun run --filter @hyperframes/studio build`.
  it.each([
    ["index-BRr1JoHX.js", true],
    ["index-DnRfAiK2.css", true],
    ["hyperframes-player-lPOqAC3l.js", true],
    ["index-RPEcu_bT.js", true],
    ["unhashed.js", false],
    ["vite-manifest.json", false],
    ["favicon.svg", false],
    // A hyphenated name is not a hash, however many capitals it carries: only
    // the segment after the last hyphen is a hash candidate.
    ["user-Guide-v2.js", false],
    ["brand-Logo-Dark.svg", false],
  ])("classifies %s", (name, hashed) => {
    expect(isContentHashedAsset(name)).toBe(hashed);
  });
});

describe("studio bundle transfer encoding", () => {
  it("compresses a bundle for a client that accepts gzip", async () => {
    const response = await server.app.request(`/assets/${HASHED_BUNDLE}`, {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    // The middleware must not corrupt the payload it shrinks. `Response.text()`
    // does not decode Content-Encoding, so unwrap it explicitly.
    const body = response.body;
    if (!body) throw new Error("compressed response had no body");
    const decoded = await new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();
    expect(decoded).toBe(BUNDLE_BYTES);
  });

  it("sends the raw bytes to a client that accepts no encoding", async () => {
    const response = await server.app.request(`/assets/${HASHED_BUNDLE}`);

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.text()).toBe(BUNDLE_BYTES);
  });
});
