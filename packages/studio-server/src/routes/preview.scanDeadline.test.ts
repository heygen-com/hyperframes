// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

vi.mock("../helpers/projectDisk.js", async (real) => {
  const disk = await real<typeof import("../helpers/projectDisk.js")>();
  return {
    ...disk,
    resolveExistingProjectFileOff: (base: string, rel: string) =>
      rel.endsWith("held.js")
        ? new Promise<never>(() => {})
        : disk.resolveExistingProjectFileOff(base, rel),
  };
});

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-scan-deadline-"));
mkdirSync(join(projectDir, "scenes"));
writeFileSync(join(projectDir, "index.html"), "<html><head></head><body></body></html>");
writeFileSync(join(projectDir, "held.js"), "window.held = true;");
const scene = (script: string) =>
  `<div data-composition-id="card" data-width="320" data-height="180"><p>Hi</p>${script}</div>`;
writeFileSync(join(projectDir, "scenes", "plain.html"), scene(""));
writeFileSync(join(projectDir, "scenes", "held.html"), scene('<script src="held.js"></script>'));
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir: projectDir }),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(projectDir, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};
const DEADLINE_MS = 200;
const api = createStudioApi(adapter, { subCompositionDeadlineMs: DEADLINE_MS });
// Starts the build worker both share, which a 200 ms request cannot wait for.
const patient = createStudioApi(adapter, { subCompositionDeadlineMs: 60_000 });
const comp = (file: string, on = api) =>
  on.request(`http://localhost/projects/demo/preview/comp/scenes/${file}`);

describe("the preview builder's script scan inside a request's deadline", () => {
  // fails without the fix: a held lookup kept the request for the scan's own 1 s, past a 200 ms deadline.
  it("gives up within the request's time, and the preview is still served", async () => {
    expect((await comp("plain.html", patient)).status).toBe(200);
    expect((await comp("plain.html")).status).toBe(200);
    const started = performance.now();
    const res = await comp("held.html");
    expect(res.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(500);
  }, 30_000);
});
