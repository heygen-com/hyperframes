import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPreviewJob } from "../helpers/previewJobs";
import { registerProjectRoutes } from "./projects";
import type { StudioApiAdapter } from "../types";

const scan = vi.hoisted(() => ({
  result: undefined as ((files: string[]) => Promise<unknown>) | undefined,
}));
vi.mock("../helpers/subCompositionBuild", async (original) => {
  const actual = await original<typeof import("../helpers/subCompositionBuild")>();
  const runOffThread: typeof actual.runOffThread = (job, ...rest) =>
    scan.result && job.kind === "compositions"
      ? (scan.result(job.files) as ReturnType<typeof actual.runOffThread>)
      : actual.runOffThread(job, ...rest);
  return { ...actual, runOffThread };
});

const tempDirs: string[] = [];

afterEach(() => {
  scan.result = undefined;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const COMPOSITION_HTML = '<html><body><div data-composition-id="main"></div></body></html>';

// Project layout for #1384: real compositions at the root and under
// compositions/, plus dot-directory content that exercises discovery gating
// and the file tree's backup-only hiding (#1366):
//   - .cache/examples/        a vendored dot-dir. walkDir does NOT special-case
//                             it, so it stays listed in the file tree, but it is
//                             gated out of composition discovery (isInHiddenOrVendorDir).
//   - .hyperframes/examples/  under the app's folder — gated out of discovery,
//                             and hidden from the tree like every non-Studio record.
//   - .hyperframes/backup/    Studio's internal snapshots — hidden from the tree.
function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-projects-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), COMPOSITION_HTML);
  mkdirSync(join(projectDir, "compositions"));
  writeFileSync(join(projectDir, "compositions", "scene.html"), COMPOSITION_HTML);
  mkdirSync(join(projectDir, ".cache", "examples"), { recursive: true });
  writeFileSync(join(projectDir, ".cache", "examples", "preset.html"), COMPOSITION_HTML);
  mkdirSync(join(projectDir, ".hyperframes", "examples"), { recursive: true });
  writeFileSync(join(projectDir, ".hyperframes", "examples", "preset.html"), COMPOSITION_HTML);
  mkdirSync(join(projectDir, ".hyperframes", "backup"), { recursive: true });
  writeFileSync(join(projectDir, ".hyperframes", "backup", "snapshot.html"), COMPOSITION_HTML);
  return projectDir;
}

function createAdapter(projectDir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
  };
}

describe("GET /projects/:id/signature", () => {
  it("returns the adapter's cached signature when provided", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, {
      ...createAdapter(projectDir),
      getProjectSignature: () => "cached-sig",
    });

    const response = await app.request("http://localhost/projects/demo/signature");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signature: "cached-sig" });
  });

  // fails without the fix: the polled signature walked every file synchronously, holding a host's event loop (a
  // desktop app's main process) for the whole walk.
  it("lets the event loop run while it walks a project", async () => {
    const projectDir = createProjectDir();
    for (let i = 0; i < 300; i++)
      writeFileSync(join(projectDir, `clip-${i}.html`), COMPOSITION_HTML);
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));
    let turns = 0;
    let answered = false;
    const turn = () => {
      if (answered) return;
      turns++;
      setImmediate(turn);
    };
    setImmediate(turn);

    const response = await app.request("http://localhost/projects/demo/signature");
    answered = true;
    expect(response.status).toBe(200);
    expect(turns).toBeGreaterThan(0);
  });

  it("computes a signature that moves when project files change", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const first = (await (
      await app.request("http://localhost/projects/demo/signature")
    ).json()) as {
      signature: string;
    };
    expect(first.signature).toMatch(/^[0-9a-f]{24}$/);

    writeFileSync(join(projectDir, "compositions", "scene.html"), "<html><body>new</body></html>");
    const second = (await (
      await app.request("http://localhost/projects/demo/signature")
    ).json()) as { signature: string };
    expect(second.signature).not.toBe(first.signature);
  });

  it("ignores generated cache writes while detecting source edits", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));
    const getSignature = async () =>
      (
        (await (await app.request("http://localhost/projects/demo/signature")).json()) as {
          signature: string;
        }
      ).signature;

    const initial = await getSignature();
    const generatedFiles = [
      [".transcode-cache", "proxy.mp4"],
      [".thumbnails", "frame.jpg"],
      [".waveform-cache", "peaks.json"],
    ] as const;
    const generatedSignatures: string[] = [];
    for (const [dir, file] of generatedFiles) {
      mkdirSync(join(projectDir, dir));
      writeFileSync(join(projectDir, dir, file), `generated ${dir}`);
      generatedSignatures.push(await getSignature());
    }

    expect(generatedSignatures).toEqual([initial, initial, initial]);

    mkdirSync(join(projectDir, "src"));
    writeFileSync(join(projectDir, "src", "scene.ts"), "export const scene = true;");
    expect(await getSignature()).not.toBe(initial);
  });

  it("404s for an unknown project", async () => {
    const app = new Hono();
    registerProjectRoutes(app, {
      ...createAdapter(createProjectDir()),
      resolveProject: async () => null,
    });
    const response = await app.request("http://localhost/projects/nope/signature");
    expect(response.status).toBe(404);
  });
});

describe("registerProjectRoutes — composition discovery (#1384)", () => {
  it("excludes HTML inside dot-directories from compositions", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { compositions?: string[] };

    expect(response.status).toBe(200);
    expect(payload.compositions).toContain("index.html");
    expect(payload.compositions).toContain("compositions/scene.html");
    expect(payload.compositions).not.toContain(".cache/examples/preset.html");
    expect(payload.compositions).not.toContain(".hyperframes/examples/preset.html");
  });

  // fails without the fix: a page saved by `hyperframes capture` was listed when its text held the marker.
  it("does not list a captured page whose text only looks like the marker", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "extracted"));
    writeFileSync(
      join(projectDir, "extracted", "page.html"),
      '<html><body><div data-captured-composition-idata-composition-id="x"></div><script>window.ran = 1</script></body></html>',
    );
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { compositions?: string[] };

    expect(payload.compositions).toContain("index.html");
    expect(payload.compositions).not.toContain("extracted/page.html");
  });

  // fails without the fix: a page was listed when a script's text held a tag with the marker.
  it("does not list a page whose only marker is a tag written inside a script", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "extracted"));
    writeFileSync(
      join(projectDir, "extracted", "page.html"),
      '<html><body><script>const s = "<div data-composition-id=\\"x\\"></div>"; window.ran = 1</script></body></html>',
    );
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { compositions?: string[] };

    expect(payload.compositions).toContain("index.html");
    expect(payload.compositions).not.toContain("extracted/page.html");
  });

  // fails without the fix: the listing parsed each page on the request thread, so nothing else was answered meanwhile.
  it("answers another request while a first listing still parses a large page", async () => {
    const projectDir = createProjectDir();
    const large = `<html><body>${"<p>hello world</p>".repeat(700_000)}<div data-composition-id="big"></div></body></html>`;
    writeFileSync(join(projectDir, "large.html"), large);
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));
    const order: string[] = [];

    const listing = app.request("http://localhost/projects/demo").then((response) => {
      order.push("listing");
      return response.json();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const other = await app.request("http://localhost/projects");
    order.push("other");

    expect(other.status).toBe(200);
    expect(await listing).toMatchObject({
      compositions: expect.arrayContaining(["index.html", "large.html"]),
    });
    expect(order).toEqual(["other", "listing"]);
  }, 60_000);

  it("counts the pages a scan did not reach by its limit, and judges none of them", () => {
    const projectDir = createProjectDir();
    const files = ["index.html", "compositions/scene.html"];
    const scan = (timeLeftMs: number) =>
      runPreviewJob(
        { kind: "compositions", projectDir, files, keptBackForPageInProgressMs: 5_000 },
        timeLeftMs,
      );

    expect(scan(60_000)).toEqual({ compositions: files, unchecked: 0 });
    expect(scan(4_000)).toEqual({ compositions: [], unchecked: 2 });
  });

  // A list that misses pages would drop open compositions in Studio, which keeps its last list when none is sent.
  it.each([
    ["stops at its limit", () => Promise.resolve({ compositions: ["index.html"], unchecked: 1 })],
    ["does not end", () => Promise.reject(new Error("the build worker exited (1)"))],
  ])("sends the files but no composition list when the scan %s, and says so", async (_, result) => {
    scan.result = result;
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(createProjectDir()));

    const payload: unknown = await (await app.request("http://localhost/projects/demo")).json();

    expect(payload).toMatchObject({ files: expect.arrayContaining(["index.html"]) });
    expect(payload).not.toHaveProperty("compositions");
    expect(warned).toHaveBeenCalledTimes(1);
  });

  // fails without the fix: each listing put its own scan in the worker's queue.
  it("gives listings that arrive during a scan one shared scan after it", async () => {
    let scansAsked = 0;
    const ends: Array<() => void> = [];
    scan.result = () => {
      scansAsked++;
      return new Promise((resolve) =>
        ends.push(() => resolve({ compositions: ["index.html"], unchecked: 0 })),
      );
    };
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(createProjectDir()));
    const ask = () => app.request("http://localhost/projects/demo").then((r) => r.json());

    const listings = [ask(), ask(), ask(), ask()];
    await vi.waitFor(() => expect(ends).toHaveLength(1));
    ends[0]?.();
    await vi.waitFor(() => expect(ends).toHaveLength(2));
    ends[1]?.();

    for (const listing of await Promise.all(listings))
      expect(listing).toMatchObject({ compositions: ["index.html"] });
    expect(scansAsked).toBe(2);
  });

  // fails without the fix: a listing sent the files it saw itself with the compositions of the scan it shared, which
  // read a later file list.
  it("sends files and compositions from one reading when a page is added between two listings that share a scan", async () => {
    const ends: Array<() => void> = [];
    scan.result = (files) =>
      new Promise((resolve) => ends.push(() => resolve({ compositions: files, unchecked: 0 })));
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));
    const ask = () => app.request("http://localhost/projects/demo").then((r) => r.json());

    const first = ask();
    await vi.waitFor(() => expect(ends).toHaveLength(1));
    const before = ask();
    // the listing reads its files a turn after it is asked: the page is added once it has
    await new Promise((resolve) => setImmediate(resolve));
    writeFileSync(join(projectDir, "added.html"), COMPOSITION_HTML);
    const after = ask();
    ends[0]?.();
    await vi.waitFor(() => expect(ends).toHaveLength(2));
    ends[1]?.();

    for (const listing of await Promise.all([first, before, after])) {
      const { files, compositions } = listing as { files: string[]; compositions: string[] };
      expect(files).toEqual(expect.arrayContaining(compositions));
    }
    expect(await first).not.toMatchObject({ files: expect.arrayContaining(["added.html"]) });
    expect(await before).toEqual(await after);
    expect(await after).toMatchObject({ compositions: expect.arrayContaining(["added.html"]) });
  });

  it("lists no hidden file but Studio's own and the media folder's, nothing under .hyperframes/ that isn't Studio's", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, ".hyperframes", "app-history.jsonl"), "{}");
    writeFileSync(join(projectDir, ".hyperframes", "studio-motion.json"), "{}");
    writeFileSync(join(projectDir, ".dev.vars"), "TOKEN=x");
    mkdirSync(join(projectDir, ".pulumi"));
    writeFileSync(join(projectDir, ".pulumi", "credentials.json"), "{}");
    mkdirSync(join(projectDir, ".media", "audio"), { recursive: true });
    writeFileSync(join(projectDir, ".media", "audio", "bgm.wav"), "RIFF");
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { files?: string[] };

    expect(payload.files).toContain(".hyperframes/studio-motion.json");
    expect(payload.files).toContain(".media/audio/bgm.wav");
    for (const hidden of [".cache/examples/preset.html", ".dev.vars", ".pulumi/credentials.json"])
      expect(payload.files).not.toContain(hidden);
    for (const hidden of ["examples/preset.html", "backup/snapshot.html", "app-history.jsonl"])
      expect(payload.files).not.toContain(`.hyperframes/${hidden}`);
  });

  it("lists nothing under a nested project's .hyperframes/", async () => {
    const projectDir = createProjectDir();
    const nested = join(projectDir, "compositions", "x");
    mkdirSync(join(nested, ".hyperframes", "backup"), { recursive: true });
    writeFileSync(join(nested, "index.html"), COMPOSITION_HTML);
    writeFileSync(join(nested, ".hyperframes", "app-history.jsonl"), "{}");
    writeFileSync(join(nested, ".hyperframes", "studio-motion.json"), "{}");
    writeFileSync(join(nested, ".hyperframes", "backup", "snapshot.html"), COMPOSITION_HTML);
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { files: string[]; compositions: string[] };

    expect(payload.files).toContain("compositions/x/index.html");
    expect(payload.compositions).toContain("compositions/x/index.html");
    expect(payload.files.filter((file) => file.includes("/.hyperframes"))).toEqual([]);
  });

  it("omits generated cache files from the project file tree", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, ".transcode-cache"));
    writeFileSync(join(projectDir, ".transcode-cache", "proxy.mp4"), "proxy");
    mkdirSync(join(projectDir, ".waveform-cache"));
    writeFileSync(join(projectDir, ".waveform-cache", "peaks.json"), "[]");
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { files?: string[] };

    expect(payload.files).not.toContain(".transcode-cache/proxy.mp4");
    expect(payload.files).not.toContain(".waveform-cache/peaks.json");
  });
});
