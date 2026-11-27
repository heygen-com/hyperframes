// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import { runOffThread } from "../helpers/subCompositionBuild";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-comp-deadline-"));
mkdirSync(join(projectDir, "scenes"));
writeFileSync(join(projectDir, "index.html"), "<html><head></head><body></body></html>");
writeFileSync(
  join(projectDir, "scenes", "small.html"),
  '<div data-composition-id="small" data-width="320" data-height="180"><p>Hi</p></div>',
);
// A page a shared project could carry: big enough that building it takes seconds.
const cells = '<div class="c" style="background:url(a.png)"><img src="b.png"></div>'.repeat(
  300_000,
);
writeFileSync(
  join(projectDir, "scenes", "huge.html"),
  `<div data-composition-id="huge" data-width="320" data-height="180">${cells}</div>`,
);
// Big enough to take a while, small enough to build inside a patient deadline.
writeFileSync(
  join(projectDir, "scenes", "large.html"),
  `<div data-composition-id="large" data-width="320" data-height="180">${cells.slice(0, cells.length / 30)}</div>`,
);
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
// Both share the one build worker; this one waits for a fresh worker to start.
const patient = createStudioApi(adapter, { subCompositionDeadlineMs: 60_000 });
const comp = (file: string, on = api) =>
  on.request(`http://localhost/projects/demo/preview/comp/scenes/${file}`);

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

describe("a sub-composition preview build", () => {
  // fails without the fix: the page built on the request thread, holding the server until it finished.
  it("past its deadline is refused, and the request thread stays free while it builds", async () => {
    let status = 0;
    const stall = await longestStall(comp("huge.html").then((res) => (status = res.status)));
    expect(status).toBe(503);
    expect(stall).toBeLessThan(DEADLINE_MS);
  }, 30_000);

  // Rames on #7857: the passes after the build parse the page too; they run on the worker as well.
  it("inside its deadline is served whole, and the request thread stays free for all of it", async () => {
    let res: Response | undefined;
    const stall = await longestStall(comp("large.html", patient).then((answer) => (res = answer)));
    expect(res?.status).toBe(200);
    expect((await res?.text())?.length).toBeGreaterThan(cells.length / 30);
    expect(stall).toBeLessThan(DEADLINE_MS);
  }, 90_000);

  it("refused while it waited behind another build says when to ask again; one that ran out its own time does not", async () => {
    const ranOut = await comp("huge.html");
    expect(ranOut.status).toBe(503);
    expect(ranOut.headers.get("retry-after")).toBeNull();

    const busy = runOffThread(
      { kind: "parts", html: "<p>busy</p>".repeat(1_500_000), ignore: [] },
      performance.now() + 60_000,
      "busy",
    );
    try {
      const waited = await comp("small.html");
      expect(waited.status).toBe(503);
      expect(waited.headers.get("retry-after")).toBe("5");
    } finally {
      await busy;
    }
  }, 90_000);

  it("after a refused one, the next page still builds", async () => {
    expect((await comp("huge.html")).status).toBe(503);
    const res = await comp("small.html", patient);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/<p[^>]*>Hi<\/p>/);
  }, 90_000);
});
