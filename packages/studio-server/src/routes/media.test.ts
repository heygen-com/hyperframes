// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMediaRoutes } from "./media";
import type { MediaProcessingJobState, StudioApiAdapter } from "../types";

const tempProjectDirs: string[] = [];

afterEach(() => {
  for (const dir of tempProjectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createAdapter(
  startBackgroundRemoval?: StudioApiAdapter["startBackgroundRemoval"],
  probeMediaMetadata?: NonNullable<Parameters<typeof registerMediaRoutes>[2]>["probeMediaMetadata"],
): {
  app: Hono;
  projectDir: string;
  startBackgroundRemoval: ReturnType<typeof vi.fn>;
} {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-media-route-test-"));
  tempProjectDirs.push(projectDir);

  mkdirSync(join(projectDir, "assets"), { recursive: true });
  writeFileSync(join(projectDir, "assets", "clip.mp4"), "video");
  writeFileSync(join(projectDir, "assets", "photo.jpg"), "image");

  const spy = vi.fn(startBackgroundRemoval);
  const adapter: StudioApiAdapter = {
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
    ...(startBackgroundRemoval ? { startBackgroundRemoval: spy } : {}),
  };
  const app = new Hono();
  registerMediaRoutes(app, adapter, probeMediaMetadata ? { probeMediaMetadata } : undefined);
  return { app, projectDir, startBackgroundRemoval: spy };
}

function completeJob(opts: Parameters<NonNullable<StudioApiAdapter["startBackgroundRemoval"]>>[0]) {
  return {
    id: opts.jobId,
    status: "complete",
    progress: 100,
    inputAssetPath: opts.inputAssetPath,
    outputAssetPath: opts.outputAssetPath,
    outputPath: opts.outputPath,
  } satisfies MediaProcessingJobState;
}

describe("registerMediaRoutes", () => {
  it("returns metadata for a project-local media asset", async () => {
    const probe = vi.fn(async () => ({
      kind: "video" as const,
      color: {
        dynamicRange: "hdr" as const,
        hdrTransfer: "hlg" as const,
        label: "HDR HLG",
        isHdr: true,
      },
    }));
    const { app, projectDir } = createAdapter(undefined, probe);

    const response = await app.request(
      "http://localhost/projects/demo/media/metadata?path=assets%2Fclip.mp4",
    );
    const data = (await response.json()) as { metadata: { color: { label: string } } };

    expect(response.status).toBe(200);
    expect(data.metadata.color.label).toBe("HDR HLG");
    expect(probe).toHaveBeenCalledWith(join(projectDir, "assets", "clip.mp4"));
  });

  it("rejects media metadata paths outside the project", async () => {
    const { app } = createAdapter();

    const response = await app.request(
      "http://localhost/projects/demo/media/metadata?path=..%2Fsecret.mp4",
    );

    expect(response.status).toBe(403);
  });

  it("rejects null bytes in media metadata paths", async () => {
    const { app } = createAdapter();

    const response = await app.request(
      "http://localhost/projects/demo/media/metadata?path=assets%00clip.mp4",
    );

    expect(response.status).toBe(403);
  });

  it("returns 501 when background removal is not available", async () => {
    const { app } = createAdapter();

    const response = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "assets/clip.mp4" }),
    });

    expect(response.status).toBe(501);
  });

  // Windows needs a privilege to create symlinks.
  it.skipIf(process.platform === "win32")(
    "writes background-removal output to the folder it checked, though a link on its path is retargeted",
    async () => {
      const outside = mkdtempSync(join(tmpdir(), "hf-media-outside-"));
      tempProjectDirs.push(outside);
      let dir = "";
      const { app, projectDir } = createAdapter((opts) => {
        rmSync(join(dir, "cutouts"));
        symlinkSync(outside, join(dir, "cutouts"), "dir");
        writeFileSync(opts.outputPath, "cutout");
        return completeJob(opts);
      });
      dir = projectDir;
      mkdirSync(join(projectDir, "real"));
      symlinkSync(join(projectDir, "real"), join(projectDir, "cutouts"), "dir");

      await app.request("http://localhost/projects/demo/media/remove-background", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputPath: "assets/photo.jpg", outputPath: "cutouts/photo.png" }),
      });

      expect(readdirSync(outside)).toEqual([]);
      expect(readFileSync(join(projectDir, "real", "photo.png"), "utf-8")).toBe("cutout");
    },
  );

  it("rejects remote input paths", async () => {
    const { app, startBackgroundRemoval } = createAdapter(completeJob);

    const response = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "https://example.com/clip.mp4" }),
    });

    expect(response.status).toBe(400);
    expect(startBackgroundRemoval).not.toHaveBeenCalled();
  });

  it("rejects null bytes in background-removal paths", async () => {
    const { app, startBackgroundRemoval } = createAdapter(completeJob);

    const inputResponse = await app.request(
      "http://localhost/projects/demo/media/remove-background",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputPath: "assets/clip\0.mp4" }),
      },
    );
    const outputResponse = await app.request(
      "http://localhost/projects/demo/media/remove-background",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputPath: "assets/clip.mp4", outputPath: "assets/out\0.webm" }),
      },
    );

    expect(inputResponse.status).toBe(403);
    expect(outputResponse.status).toBe(403);
    expect(startBackgroundRemoval).not.toHaveBeenCalled();
  });

  it("starts a video cutout job with safe default output paths", async () => {
    const { app, projectDir, startBackgroundRemoval } = createAdapter(completeJob);

    const response = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "assets/clip.mp4", createBackgroundPlate: true }),
    });
    const data = (await response.json()) as {
      jobId: string;
      outputPath: string;
      backgroundOutputPath: string;
    };

    expect(response.status).toBe(200);
    expect(data.outputPath).toBe("assets/cutouts/clip-cutout.webm");
    expect(data.backgroundOutputPath).toBe("assets/cutouts/clip-plate.webm");
    expect(startBackgroundRemoval).toHaveBeenCalledWith(
      expect.objectContaining({
        project: { id: "demo", dir: projectDir },
        inputAssetPath: "assets/clip.mp4",
        outputAssetPath: "assets/cutouts/clip-cutout.webm",
        backgroundOutputAssetPath: "assets/cutouts/clip-plate.webm",
        quality: "balanced",
        device: "auto",
        jobId: data.jobId,
      }),
    );
  });

  it("gives a second removal of the same clip its own output names while the first still runs", async () => {
    const { app } = createAdapter((opts) => ({
      ...completeJob(opts),
      status: "processing" as const,
      backgroundOutputAssetPath: opts.backgroundOutputAssetPath,
    }));
    const start = async () =>
      (await (
        await app.request("http://localhost/projects/demo/media/remove-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputPath: "assets/clip.mp4", createBackgroundPlate: true }),
        })
      ).json()) as { outputPath: string; backgroundOutputPath: string };

    const [first, second] = [await start(), await start()];
    expect([first.outputPath, second.outputPath]).toEqual([
      "assets/cutouts/clip-cutout.webm",
      "assets/cutouts/clip-cutout-2.webm",
    ]);
    expect(second.backgroundOutputPath).toBe("assets/cutouts/clip-plate-2.webm");
  });

  it.each([
    [
      "an explicit output spelled another way",
      { outputPath: "assets//cutouts/clip-cutout.webm" },
      "clip-cutout-2.webm",
    ],
    [
      "a plate asked for under the cutout's own name",
      { outputPath: "assets/cutouts/clip-plate.webm" },
      "clip-plate-2.webm",
    ],
  ])("never gives two outputs one name: %s", async (_, extra, plate) => {
    const { app } = createAdapter((opts) => ({
      ...completeJob(opts),
      status: "processing" as const,
      backgroundOutputAssetPath: opts.backgroundOutputAssetPath,
    }));
    const start = async (body: object) =>
      (await (
        await app.request("http://localhost/projects/demo/media/remove-background", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputPath: "assets/clip.mp4", ...body }),
        })
      ).json()) as { outputPath: string; backgroundOutputPath?: string };

    const first = await start({});
    const second = await start({ ...extra, createBackgroundPlate: true });
    const names = [first.outputPath, second.outputPath, second.backgroundOutputPath];
    expect(new Set(names).size).toBe(3);
    expect(names.join(" ")).toContain(plate);
  });

  it("normalizes query strings from local media paths", async () => {
    const { app, startBackgroundRemoval } = createAdapter(completeJob);

    const response = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "./assets/clip.mp4?v=123#frame" }),
    });

    expect(response.status).toBe(200);
    expect(startBackgroundRemoval).toHaveBeenCalledWith(
      expect.objectContaining({
        inputAssetPath: "assets/clip.mp4",
        outputAssetPath: "assets/cutouts/clip-cutout.webm",
      }),
    );
  });

  it("requires png output for image cutouts", async () => {
    const { app, startBackgroundRemoval } = createAdapter(completeJob);

    const response = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "assets/photo.jpg", outputPath: "assets/photo.webm" }),
    });

    expect(response.status).toBe(400);
    expect(startBackgroundRemoval).not.toHaveBeenCalled();
  });

  it("keeps output paths inside the project", async () => {
    const { app, startBackgroundRemoval } = createAdapter(completeJob);

    const response = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "assets/clip.mp4", outputPath: "../escape.webm" }),
    });

    expect(response.status).toBe(403);
    expect(startBackgroundRemoval).not.toHaveBeenCalled();
  });
});
