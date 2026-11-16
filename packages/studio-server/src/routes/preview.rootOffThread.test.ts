// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-root-off-thread-"));
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));
// A traced illustration's worth of distinct shapes: parsing it takes the request thread seconds.
const shapes = Array.from(
  { length: 40_000 },
  (_, i) => `<path d="M${i % 97} ${i % 89}l9 1 6 8-3 9-8 1z" fill="hsl(${i % 360} 70% 55%)"/>`,
).join("");
const page = `<!doctype html><html><head></head><body><div id="root" data-composition-id="main" data-width="320" data-height="180"><svg viewBox="0 0 100 100">${shapes}</svg><p id="hello">Hi</p></div></body></html>`;
writeFileSync(join(projectDir, "index.html"), page);

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir: projectDir }),
  bundle: async () => page,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(projectDir, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};

/** The longest the request thread went without running a timer while `work` ran. */
async function longestStall(work: Promise<unknown>): Promise<number> {
  let last = performance.now();
  let longest = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  await work;
  clearInterval(tick);
  return longest;
}

// fails without the fix: the root page's parse passes ran on the request thread, holding it for the whole build while
// Desktop's capture window built a poster beside a playing film.
it("a large root preview, captured or not, is served whole while the request thread stays free", async () => {
  const api = createStudioApi(adapter);
  for (const query of ["", "?hf-capture=1"]) {
    let res: Response | undefined;
    const stall = await longestStall(
      api
        .request(`http://localhost/projects/demo/preview${query}`)
        .then((answer) => (res = answer)),
    );
    expect(res?.status).toBe(200);
    const html = (await res?.text()) ?? "";
    expect(html).toMatch(/<p[^>]*id="hello"[^>]*>Hi<\/p>/);
    expect(stall).toBeLessThan(200);
  }
}, 120_000);
