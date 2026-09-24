import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files.js";
import { registerPreviewRoutes } from "./preview.js";
import { registerThumbnailRoutes } from "./thumbnail.js";
import { registerWaveformRoutes } from "./waveform.js";
import { buildWaveformCacheKey } from "../helpers/waveform.js";
import type { StudioApiAdapter } from "../types.js";

// Project ids come from folder names, so any character a folder allows must survive the URL.
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
  } as unknown as StudioApiAdapter;
}

function projectWithComposition(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hf-projectid-"));
  writeFileSync(join(dir, "index.html"), "<html><body>COMPOSITION</body></html>");
  mkdirSync(join(dir, "scenes"), { recursive: true });
  writeFileSync(join(dir, "scenes", "scene-1.html"), "<html><body>SCENE ONE</body></html>");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function readComposition(projectId: string, compPath = "index.html") {
  const { dir, cleanup } = projectWithComposition();
  try {
    const app = new Hono();
    registerFileRoutes(app, createAdapter(dir));
    const url = `http://localhost/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(compPath)}?optional=1`;
    const response = await app.request(url);
    const body = (await response.json()) as { content?: string };
    return { status: response.status, content: body.content };
  } finally {
    cleanup();
  }
}

describe("project ids that percent-encode in a URL", () => {
  it("serves a composition from a plain ASCII project id", async () => {
    const result = await readComposition("demo-project");
    expect(result.status).toBe(200);
    expect(result.content).toContain("COMPOSITION");
  });

  it("serves a composition when the project folder name has a space", async () => {
    const result = await readComposition("my video");
    expect(result.status).toBe(200);
    expect(result.content).toContain("COMPOSITION");
  });

  it("serves a composition when the project folder name is non-ASCII", async () => {
    const result = await readComposition("用故事板做视频");
    expect(result.status).toBe(200);
    expect(result.content).toContain("COMPOSITION");
  });

  // Sub-compositions are the house pattern — one per scene — so the active
  // composition is very often in a subdirectory. encodeURIComponent turns the
  // separator into %2F, which is what the client sends.
  it("serves a sub-composition in a subdirectory", async () => {
    const result = await readComposition("demo-project", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.content).toContain("SCENE ONE");
  });
});

// A Home sentence with an @ mention names the project; Hono leaves %40 %25 %23 %26 %3F encoded in c.req.path.
const RESERVED_NAMES = [
  "A @HyperFrames launch",
  "50% off",
  "#2 take",
  "Tom & Jerry",
  "why?",
  "two  spaces",
  "café crème",
  "🎬 film",
];

type ThumbnailCall = { compPath: string; previewUrl: string };

async function requestProject(projectId: string, route: string, encodedSubPath: string) {
  const { dir, cleanup } = projectWithComposition();
  writeFileSync(join(dir, "scenes", "voice.wav"), "RIFF");
  // The waveform route's own cache hit, so no audio decoder runs.
  const voice = statSync(join(dir, "scenes", "voice.wav"));
  mkdirSync(join(dir, ".waveform-cache"));
  writeFileSync(
    join(dir, ".waveform-cache", buildWaveformCacheKey("scenes/voice.wav", voice)),
    "[0.5]",
  );
  const thumbnails: ThumbnailCall[] = [];
  const adapter = {
    ...createAdapter(dir),
    generateThumbnail: async (opts: ThumbnailCall) => {
      thumbnails.push({ compPath: opts.compPath, previewUrl: opts.previewUrl });
      return Buffer.from("jpeg");
    },
  } as StudioApiAdapter;
  try {
    const app = new Hono();
    registerFileRoutes(app, adapter);
    registerPreviewRoutes(app, adapter);
    registerThumbnailRoutes(app, adapter);
    registerWaveformRoutes(app, adapter);
    const response = await app.request(
      `http://localhost/projects/${encodeURIComponent(projectId)}/${route}/${encodedSubPath}`,
    );
    return { status: response.status, text: await response.text(), thumbnails };
  } finally {
    cleanup();
  }
}

describe.each(RESERVED_NAMES)("project id %j", (projectId) => {
  it("reads a project file", async () => {
    const result = await readComposition(projectId, "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.content).toContain("SCENE ONE");
  });

  it("serves a preview asset", async () => {
    const result = await requestProject(projectId, "preview", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.text).toContain("SCENE ONE");
  });

  it("serves a preview sub-composition", async () => {
    const result = await requestProject(projectId, "preview/comp", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.text).toContain("SCENE ONE");
  });

  it("thumbnails a sub-composition through a preview URL that parses back to it", async () => {
    const result = await requestProject(projectId, "thumbnail", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.thumbnails).toHaveLength(1);
    expect(result.thumbnails[0]?.compPath).toBe("scenes/scene-1.html");
    const url = new URL(result.thumbnails[0]?.previewUrl ?? "");
    expect(url.search + url.hash).toBe("");
    const segments = url.pathname.split("/").map(decodeURIComponent);
    expect(segments).toEqual([
      "",
      "api",
      "projects",
      projectId,
      "preview",
      "comp",
      "scenes",
      "scene-1.html",
    ]);
  });

  it("serves an audio waveform", async () => {
    const result = await requestProject(projectId, "waveform", "scenes/voice.wav");
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({ peaks: [0.5] });
  });
});

// Encoded as one segment: a literal ../ is normalised away before routing.
const OUTSIDE_PROJECT = encodeURIComponent(`${"../".repeat(24)}etc/hosts`);

describe("a sub-path that decodes to a parent directory", () => {
  it("is not thumbnailed", async () => {
    const result = await requestProject("demo-project", "thumbnail", OUTSIDE_PROJECT);
    expect(result.status).toBe(404);
    expect(result.thumbnails).toHaveLength(0);
  });

  it("is not read for a waveform", async () => {
    const result = await requestProject("demo-project", "waveform", OUTSIDE_PROJECT);
    expect(result.status).toBe(404);
  });
});
