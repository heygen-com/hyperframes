import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const probed = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...actual,
    extractMediaMetadata: async (path: string) => {
      probed.paths.push(path);
      return { durationSeconds: 1, isVFR: false };
    },
    probeMediaProfile: async (path: string) => {
      probed.paths.push(path);
      return { hasVideoStream: true, hasAudioStream: false, visualKind: "moving" };
    },
    analyzeKeyframeIntervals: async (path: string) => {
      probed.paths.push(path);
      return { isProblematic: false, maxIntervalSeconds: 0 };
    },
  };
});

vi.mock("../utils/ffprobe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/ffprobe.js")>();
  return {
    ...actual,
    extractMediaMetadata: async (path: string) => {
      probed.paths.push(path);
      return { durationSeconds: 1, isVFR: false };
    },
  };
});

import { compileForRender } from "./htmlCompiler.js";

describe("hidden video clips", () => {
  let projectDir: string | undefined;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    projectDir = undefined;
    probed.paths.length = 0;
  });

  it("are not probed or collected, while a visible clip still is", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-hidden-probe-"));
    for (const src of ["own.mp4", "inherited.mp4", "shown.mp4"]) {
      writeFileSync(join(projectDir, src), "fixture");
    }
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body>
        <div data-composition-id="root" data-width="320" data-height="180" data-duration="1">
          <video id="own" src="own.mp4" data-hidden data-start="0" data-duration="1"></video>
          <div data-hidden><video id="inherited" src="inherited.mp4" data-start="0" data-duration="1"></video></div>
          <video id="shown" src="shown.mp4" data-start="0" data-duration="1"></video>
        </div>
      </body></html>`,
    );

    const compiled = await compileForRender(projectDir, htmlPath, join(projectDir, "downloads"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(compiled.videos.map((v) => v.id)).toEqual(["shown"]);
    expect(probed.paths.length).toBeGreaterThan(0);
    expect(probed.paths.every((path) => path.endsWith("shown.mp4"))).toBe(true);
  });
});
