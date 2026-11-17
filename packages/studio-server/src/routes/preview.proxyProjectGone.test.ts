// @vitest-environment node
// Node's Request keeps the Sec-Fetch-Site header the Studio API needs before it starts proxy work;
// happy-dom's drops it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../helpers/mediaMetadata.js");
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html><head></head><body>Preview</body></html>");
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

describe("an hf-proxy request whose project folder goes away", () => {
  it("answers that the project folder is gone when it is renamed while a proxy is requested", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
    vi.resetModules();
    vi.doMock("../helpers/mediaMetadata.js", async () => ({
      ...(await vi.importActual<typeof import("../helpers/mediaMetadata.js")>(
        "../helpers/mediaMetadata.js",
      )),
      probeMediaMetadata: async () => {
        tempDirs.push(`${projectDir}-renamed`);
        renameSync(projectDir, `${projectDir}-renamed`);
        return { kind: "video" as const, color: { codecName: "hevc", pixelFormat: "yuv420p" } };
      },
    }));
    const { createStudioApi: create } = await import("../createStudioApi.js");
    const api = create(createAdapter(projectDir));

    const response = await api.request(
      "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      { headers: { "sec-fetch-site": "same-origin" } },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
  });

  it("answers that the project folder is gone when a rename makes the codec probe fail", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
    vi.resetModules();
    vi.doMock("../helpers/mediaMetadata.js", async () => ({
      ...(await vi.importActual<typeof import("../helpers/mediaMetadata.js")>(
        "../helpers/mediaMetadata.js",
      )),
      probeMediaMetadata: async () => {
        tempDirs.push(`${projectDir}-renamed`);
        renameSync(projectDir, `${projectDir}-renamed`);
        return { kind: "video" as const, color: {}, probeError: "ffprobe failed" };
      },
    }));
    const { createStudioApi: create } = await import("../createStudioApi.js");
    const api = create(createAdapter(projectDir));

    const response = await api.request(
      "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      { headers: { "sec-fetch-site": "same-origin" } },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
  });
});
