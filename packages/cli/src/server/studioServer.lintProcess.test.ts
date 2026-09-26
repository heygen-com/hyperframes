import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

// Studio must lint outside its own process; any in-process project lint fails the request.
vi.mock("@hyperframes/lint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/lint")>()),
  lintProject: () => {
    throw new Error("project lint ran on the Studio server's event loop");
  },
}));

const { createStudioServer } = await import("./studioServer.js");

let root: string;
let server: ReturnType<typeof createStudioServer>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "hf-studio-lint-"));
  fs.writeFileSync(
    path.join(root, "index.html"),
    `<!doctype html><html><head></head><body>
<div id="root" data-composition-id="main" data-width="320" data-height="180"></div>
</body></html>`,
  );
  server = createStudioServer({ projectDir: root, projectName: "film" });
});

afterEach(() => {
  server.watcher.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("studio lint", () => {
  it("lints the project in a separate process", async () => {
    const response = await server.app.request("/api/projects/film/lint");
    const body = (await response.json()) as { findings?: Array<{ message: string }> };

    expect(response.status).toBe(200);
    expect(body.findings?.some((f) => f.message.includes("window.__timelines"))).toBe(true);
  }, 60_000);
});
