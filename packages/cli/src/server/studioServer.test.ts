import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSource } from "./runtimeSource.js";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";

// Every server-backed describe below wants the same two things: a throwaway
// project directory, and a server whose watcher is closed afterwards. Three
// copies of that got out of step, so it lives here once.
const dirs: string[] = [];
let server: StudioServer | undefined;

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-studio-server-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  server?.watcher.close();
  server = undefined;
  delete process.env.HYPERFRAMES_FFMPEG_PATH;
  delete process.env.HYPERFRAMES_FFPROBE_PATH;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadRuntimeSource", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSource()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});

describe("Studio thumbnail GPU capture plumbing", () => {
  it("uses the shared auto probe, resolved launch mode, requirement guard, and completion-aware seek", () => {
    const source = readFileSync(new URL("./studioServer.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveCaptureBrowserGpuMode");
    expect(source).toContain("{ browserGpuMode: resolvedGpuMode }");
    expect(source).toContain("assertWebGpuRequirement");
    expect(source).toContain("await seekCompositionTimeline(page, opts.seekTime");
  });
});

describe("createStudioServer autoProxy plumbing", () => {
  it("hyperframes.json media.autoProxy=false flows through to the adapter", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir });

    expect(server.adapter.autoProxy).toBe(false);
  });

  it("defaults the adapter to autoProxy=true when neither option nor config disables it", () => {
    server = createStudioServer({ projectDir: tmpProject() });
    expect(server.adapter.autoProxy).toBe(true);
  });

  it("an explicit option (the preview command's resolved --proxy flag) wins over config", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir, autoProxy: true });

    expect(server.adapter.autoProxy).toBe(true);
  });

  it("advertises the GPU policy used for thumbnail capture", async () => {
    const projectDir = tmpProject();
    server = createStudioServer({ projectDir, browserGpuMode: "software" });

    const response = await server.app.request("/__hyperframes_config");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ browserGpuMode: "software" });
  });
});

describe("Studio project lint endpoint", () => {
  it("surfaces findings that require the complete project graph", async () => {
    const projectDir = tmpProject();
    mkdirSync(join(projectDir, "compositions"));
    mkdirSync(join(projectDir, "scenes"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      join(projectDir, "compositions", "index.html"),
      `<html><body><div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    writeFileSync(join(projectDir, "scenes", "intro.html"), "<html><body>Intro</body></html>");
    server = createStudioServer({ projectDir, projectName: "demo" });

    const response = await server.app.request("http://localhost/api/projects/demo/lint");
    const payload = (await response.json()) as {
      findings?: Array<{ code?: string; file?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.findings).toContainEqual(
      expect.objectContaining({ code: "blank_root_with_standalone_composition" }),
    );
    expect(payload.findings).toContainEqual(expect.objectContaining({ file: "scenes/intro.html" }));
    expect(payload.findings?.every((finding) => !finding.file?.startsWith(projectDir))).toBe(true);
  });
});

describe("preview ETag tracks the project on disk", () => {
  const composition = (body: string) =>
    `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"><div class="clip" data-start="0" data-duration="10">${body}</div></div></body></html>`;

  // The preview ETag must be derived from what is on disk right now, never from
  // a cache that only a file-watcher event can clear. `createProjectWatcher`
  // reaches a permanently silent state on its own — the constructor `catch`
  // (recursive `fs.watch` is unsupported on some platforms) and the 'error'
  // handler that nulls the handle (e.g. EMFILE) — and a signature memo cleared
  // only from that watcher then freezes the preview for the life of the
  // process, which is exactly the "restart the server to see my edit" symptom.
  it("changes after an external edit even when no watcher event ever fires", async () => {
    const projectDir = tmpProject();
    writeFileSync(join(projectDir, "index.html"), composition("Before"));
    server = createStudioServer({ projectDir, projectName: "demo" });

    const first = await server.app.request("http://localhost/api/projects/demo/preview");
    const firstEtag = first.headers.get("ETag");
    expect(first.status).toBe(200);
    expect(firstEtag).toBeTruthy();

    // Stand in for the dead/never-started handle: no listener fires again.
    server.watcher.close();
    writeFileSync(join(projectDir, "index.html"), composition("After the external edit"));

    const second = await server.app.request("http://localhost/api/projects/demo/preview");
    expect(second.status).toBe(200);
    expect(second.headers.get("ETag")).not.toBe(firstEtag);
    expect(await second.text()).toContain("After the external edit");
  });

  it("still answers 304 for a conditional request when nothing changed", async () => {
    const projectDir = tmpProject();
    writeFileSync(join(projectDir, "index.html"), composition("Unchanged"));
    server = createStudioServer({ projectDir, projectName: "demo" });

    // Warm-up: the route persists `data-hf-id` back to index.html on first
    // sight, so request #1 legitimately changes the project and invalidates its
    // own ETag. That write is idempotent, so the project is settled from here.
    await server.app.request("http://localhost/api/projects/demo/preview");

    const settled = await server.app.request("http://localhost/api/projects/demo/preview");
    const etag = settled.headers.get("ETag");
    expect(etag).toBeTruthy();

    const conditional = await server.app.request("http://localhost/api/projects/demo/preview", {
      headers: { "If-None-Match": etag as string },
    });
    expect(conditional.status).toBe(304);
  });
});

describe("the /api/events SSE stream", () => {
  // Studio reconnects this stream constantly, so a listener left behind on
  // every disconnect accumulates without bound. That is not just memory: each
  // dead listener still runs on a file change, and `consumeFileWriteReceipt`
  // is one-shot, so a dead listener eats the receipt meant for the live stream.
  it("removes its watcher listener when the stream disconnects", async () => {
    server = createStudioServer({ projectDir: tmpProject(), projectName: "demo" });

    let added = 0;
    let removed = 0;
    const realAdd = server.watcher.addListener.bind(server.watcher);
    const realRemove = server.watcher.removeListener.bind(server.watcher);
    server.watcher.addListener = (fn) => {
      added += 1;
      realAdd(fn);
    };
    server.watcher.removeListener = (fn) => {
      removed += 1;
      realRemove(fn);
    };

    // Cancelling the response body is the real client-disconnect path: it is
    // what hono's StreamingApi turns into `abort()`.
    for (let i = 0; i < 5; i += 1) {
      const res = await server.app.request("http://localhost/api/events");
      await res.body?.cancel();
    }

    expect(added).toBe(5);
    expect(removed).toBe(5);
  });
});

describe("host guarding on identity-bearing responses", () => {
  // NOTE: the SPA-injection branch itself is covered in telemetryIdentity.test.ts
  // via buildStudioHeadScriptsForHost. It cannot be asserted here: this route
  // only reaches the injection branch when packages/studio/dist is built,
  // which is true locally and false in the CI test lane, so a route-level
  // assertion on the returned HTML passes on a dev box and fails in CI.

  it("refuses the identity endpoint for a hostile Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/api/telemetry-identity", {
      headers: { host: "evil.example.com" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('distinctId":"');
  });

  it("serves the identity endpoint on a loopback Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/api/telemetry-identity", {
      headers: { host: "127.0.0.1:5173" },
    });
    expect(res.status).toBe(200);
    // The seed is no longer served here at all — Studio gets decisions
    // injected instead, so nothing needs it over HTTP.
    expect(Object.keys((await res.json()) as object)).toEqual(["distinctId"]);
  });
});

// Studio asks this before it offers Export, so a machine without an encoder
// gets an install command up front instead of a 503 after the work is done.
describe("FFmpeg environment endpoint", () => {
  it("reports the cause and a pasteable command when FFmpeg is unusable", async () => {
    // A configured-but-missing override is the one "no FFmpeg" state a test can
    // force on a machine that does have FFmpeg installed.
    process.env.HYPERFRAMES_FFMPEG_PATH = join(tmpdir(), "hf-missing-ffmpeg");
    server = createStudioServer({ projectDir: tmpProject() });

    const res = await server.app.request("/api/environment/ffmpeg");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      title?: string;
      detail?: string;
      command?: string;
    };

    expect(body.ok).toBe(false);
    expect(body.title).toContain("not found");
    expect(body.detail).toBeTruthy();
    // Undefined only on platforms with no one-line install; CI runs none.
    expect(body.command).toBeTruthy();
  });

  // Needs a real FFmpeg: the check runs `-version` on whatever it resolves, so
  // a stand-in binary would only prove the stand-in works. Skipped rather than
  // faked on machines without one.
  it.skipIf(!findFFmpeg() || !findFFprobe())(
    "answers a plain ok when both binaries resolve",
    async () => {
      server = createStudioServer({ projectDir: tmpProject() });

      const res = await server.app.request("/api/environment/ffmpeg");

      expect(await res.json()).toEqual({ ok: true });
    },
  );
});
