import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer } from "./studioServer.js";

/**
 * The static SPA handlers resolve the raw request path against the bundle
 * directory. Hono decodes percent escapes when routing, so an encoded
 * separator or dot segment in the request must never walk out of the bundle
 * root — browsers would not send those shapes, but anything that can reach
 * the bound port can. These tests pin containment at the handler.
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

let root: string;
let server: Awaited<ReturnType<typeof createStudioServer>>;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(tmpdir(), "hf-studio-containment-"));
  hooks.studioDir = path.join(root, "studio");
  const projectDir = path.join(root, "project");
  fs.mkdirSync(projectDir);
  fs.mkdirSync(path.join(hooks.studioDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "studio-marker.txt"), "STUDIO-MARKER");
  fs.writeFileSync(
    path.join(hooks.studioDir, "index.html"),
    "<html><head></head><body>Studio</body></html>",
  );
  server = await createStudioServer({ projectDir });
});

afterEach(() => {
  server.watcher.close();
  fs.rmSync(root, { recursive: true, force: true });
  hooks.studioDir = "";
});

describe("static file path containment", () => {
  // A percent-encoded backslash decodes to a real separator on Windows, so
  // two encoded hops walk from the bundle root to the temp root above it.
  it.each(["/assets/..%5c..%5cstudio-marker.txt", "/icons/..%5c..%5cstudio-marker.txt"])(
    "rejects encoded traversal %s",
    async (requestPath) => {
      const response = await server.app.request(requestPath);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("STUDIO-MARKER");
    },
  );

  it("still serves the SPA shell and bundle assets", async () => {
    const shell = await server.app.request("/");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("Studio");

    fs.writeFileSync(path.join(hooks.studioDir, "assets", "app.js"), "export {};");
    const asset = await server.app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("export {};");
  });
});
