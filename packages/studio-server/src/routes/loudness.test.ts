import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLoudnessRoutes, type MeasureLoudness } from "./loudness";
import type { StudioApiAdapter } from "../types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(measure: MeasureLoudness) {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-loudness-route-"));
  dirs.push(projectDir);
  writeFileSync(join(projectDir, "talk.mp4"), "video");
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "j", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  };
  const app = new Hono();
  registerLoudnessRoutes(app, adapter, measure);
  const post = (body: unknown) =>
    app.request("/projects/p/loudness/normalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { post, projectDir };
}

describe("POST /projects/:id/loudness/normalize", () => {
  it("measures the played source window of a video and answers the -16 LUFS gain", async () => {
    const measure = vi.fn<MeasureLoudness>(async () => ({
      integratedLufs: -19.2,
      truePeakDbfs: -8,
    }));
    const { post, projectDir } = setup(measure);
    const res = await post({
      id: "a-roll",
      src: "talk.mp4",
      mediaStart: 1,
      duration: 4,
      playbackRate: 2,
      volume: 1,
    });
    expect(res.status).toBe(200);
    const { plan } = await res.json();
    expect(plan.gainDb).toBeCloseTo(3.2, 6);
    expect(plan.targetId).toBe("a-roll");
    expect(measure).toHaveBeenCalledWith(join(projectDir, "talk.mp4"), {
      mediaStart: 1,
      duration: 4,
      playbackRate: 2,
    });
  });

  it("names the limit when the gain had to stop short", async () => {
    const { post } = setup(async () => ({ integratedLufs: -22, truePeakDbfs: -3 }));
    const { plan } = await (await post({ src: "talk.mp4" })).json();
    expect(plan.limitedBy).toBe("true-peak");
  });

  it("measures a project file whose name holds %, # or ?, given raw or as a URL", async () => {
    const measure = vi.fn<MeasureLoudness>(async () => ({ integratedLufs: -16, truePeakDbfs: -3 }));
    const { post, projectDir } = setup(measure);
    const name = "sale 50% off #1?.mp3";
    writeFileSync(join(projectDir, name), "audio");

    for (const src of [name, encodeURIComponent(name), "talk.mp4?v=2#t=1"]) {
      expect((await post({ src })).status, src).toBe(200);
    }
    expect(measure.mock.calls.map(([file]) => file)).toEqual([
      join(projectDir, name),
      join(projectDir, name),
      join(projectDir, "talk.mp4"),
    ]);
  });

  it("refuses a source outside the project", async () => {
    const { post } = setup(async () => ({ integratedLufs: -16, truePeakDbfs: -3 }));
    expect((await post({ src: "../etc/passwd" })).status).toBe(400);
    expect((await post({ src: "https://x.test/a.mp3" })).status).toBe(400);
  });

  it("rejects malformed numbers", async () => {
    const { post } = setup(async () => ({ integratedLufs: -16, truePeakDbfs: -3 }));
    const res = await post({ src: "talk.mp4", playbackRate: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/playbackRate/);
  });

  it("404s a missing file and 422s a silent one", async () => {
    const { post } = setup(async () => ({ integratedLufs: -70, truePeakDbfs: -90 }));
    expect((await post({ src: "missing.wav" })).status).toBe(404);
    const silent = await post({ src: "talk.mp4" });
    expect(silent.status).toBe(422);
    expect((await silent.json()).error).toMatch(/silent/);
  });
});
