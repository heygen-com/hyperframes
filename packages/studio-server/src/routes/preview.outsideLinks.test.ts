import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPreviewRoutes } from "./preview";
import { registerPeakRoutes } from "./peaks";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function adapterFor(
  projectDir: string,
  overrides: Partial<StudioApiAdapter> = {},
): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
    ...overrides,
  };
}

function previewApp(projectDir: string, overrides: Partial<StudioApiAdapter> = {}): Hono {
  const app = new Hono();
  registerPreviewRoutes(app, adapterFor(projectDir, overrides));
  return app;
}

/** A project whose `models/<name>` links to `<outside>/<target>`, holding `body`. */
function projectLinkingOut(name: string, target: string, body: string) {
  const projectDir = tempDir("hf-outside-link-project-");
  const outside = tempDir("hf-outside-link-target-");
  mkdirSync(join(outside, target, ".."), { recursive: true });
  writeFileSync(join(outside, target), body);
  mkdirSync(join(projectDir, "models"));
  symlinkSync(join(outside, target), join(projectDir, "models", name), "file");
  return projectDir;
}

const get = (app: Hono, path: string) =>
  app.request(`http://localhost/projects/demo/preview/${path}`);

describe("preview files that link outside the project", () => {
  it("does not serve a linked file a render would leave out for its type", async () => {
    const app = previewApp(projectLinkingOut("account.bin", "account.bin", "STORE-DATA"));
    const response = await get(app, "models/account.bin");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("STORE-DATA");
  });

  it("does not serve a linked picture in an app's data folder", async () => {
    const home = realpathSync(tempDir("hf-outside-link-home-"));
    vi.stubEnv("HOME", home);
    const store = join(home, "Library", "Application Support", "App");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "avatar.svg"), "<svg>store</svg>");
    const projectDir = tempDir("hf-outside-link-project-");
    symlinkSync(join(store, "avatar.svg"), join(projectDir, "avatar.svg"), "file");
    expect((await get(previewApp(projectDir), "avatar.svg")).status).toBe(404);
  });

  it("does not serve any linked file when the host refuses outside files for the project", async () => {
    const projectDir = projectLinkingOut("shared.svg", "shared.svg", "<svg>shared</svg>");
    writeFileSync(join(projectDir, "own.svg"), "<svg>own</svg>");
    const asked: string[] = [];
    const app = previewApp(projectDir, {
      outsideAssetsAllowed: (dir) => {
        asked.push(dir);
        return false;
      },
    });
    expect((await get(app, "models/shared.svg")).status).toBe(404);
    expect(await (await get(app, "own.svg")).text()).toBe("<svg>own</svg>");
    expect(asked).toEqual([projectDir]);
  });

  it("serves a linked picture from a shared folder when the host allows outside files", async () => {
    const projectDir = projectLinkingOut("shared.svg", "shared.svg", "<svg>shared</svg>");
    const app = previewApp(projectDir, { outsideAssetsAllowed: () => true });
    const response = await get(app, "models/shared.svg");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<svg>shared</svg>");
  });

  it("does not decode a linked sound in an app's data folder for the timeline", async () => {
    const home = realpathSync(tempDir("hf-outside-link-home-"));
    vi.stubEnv("HOME", home);
    const store = join(home, "Library", "Application Support", "App");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "voice.mp3"), "not really audio");
    const projectDir = tempDir("hf-outside-link-project-");
    symlinkSync(join(store, "voice.mp3"), join(projectDir, "voice.mp3"), "file");
    const app = new Hono();
    registerPeakRoutes(app, adapterFor(projectDir), async () => [0.5]);
    expect((await app.request("http://localhost/projects/demo/peaks/voice.mp3")).status).toBe(404);
  });
});
