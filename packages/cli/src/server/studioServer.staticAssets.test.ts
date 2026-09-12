import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer, type StudioServer } from "./studioServer.js";

/**
 * Cache policy for the studio bundle, decided by ROUTE. Vite emits only
 * content-hashed files under dist/assets, so that path can be immutable;
 * public/ files (icons, favicon) keep their names across builds and the HTML
 * shell names the current bundle, so both must revalidate.
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

// A real filename from `bun run --filter @hyperframes/studio build`.
const HASHED_BUNDLE = "index-BRr1JoHX.js";
const BUNDLE_BYTES = "export const studio = 1;";
// Hand-authored, hyphenated, carrying capitals and digits — the shape no
// filename heuristic can separate from a rollup hash. It lives under /icons/,
// so the route answers correctly without having to.
const PUBLIC_ICON = "brand-Logo2026x.svg";

let root: string;
let server: StudioServer;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "hf-studio-assets-"));
  hooks.studioDir = path.join(root, "studio");
  const projectDir = path.join(root, "project");
  fs.mkdirSync(projectDir);
  fs.mkdirSync(path.join(hooks.studioDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(hooks.studioDir, "icons"), { recursive: true });
  fs.writeFileSync(path.join(hooks.studioDir, "assets", HASHED_BUNDLE), BUNDLE_BYTES);
  fs.writeFileSync(path.join(hooks.studioDir, "icons", PUBLIC_ICON), "<svg/>");
  fs.writeFileSync(path.join(hooks.studioDir, "favicon.svg"), "<svg/>");
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
  it("serves everything under /assets/ as immutable", async () => {
    const response = await server.app.request(`/assets/${HASHED_BUNDLE}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not make a public/ icon immutable, however hash-like its name", async () => {
    const response = await server.app.request(`/icons/${PUBLIC_ICON}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the favicon revalidating", async () => {
    const response = await server.app.request("/favicon.svg");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("revalidates the HTML shell without evicting it from bfcache", async () => {
    const response = await server.app.request("/");

    expect(response.status).toBe(200);
    // `no-cache`, not `no-store`: same refetch, but `no-store` would blocklist
    // the document from Chrome's bfcache and cold-boot Studio on Back.
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("sends the bundle uncompressed, which loopback measures faster", async () => {
    const response = await server.app.request(`/assets/${HASHED_BUNDLE}`, {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.text()).toBe(BUNDLE_BYTES);
  });
});
