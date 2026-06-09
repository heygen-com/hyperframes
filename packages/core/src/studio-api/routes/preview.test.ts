// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPreviewRoutes } from "./preview";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html><head></head><body>Preview</body></html>");
  return projectDir;
}

function createAdapter(
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
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
    ...overrides,
  };
}

function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch {
    return false;
  }
}

async function getPreviewSignature(projectDir: string): Promise<string> {
  const app = new Hono();
  registerPreviewRoutes(app, createAdapter(projectDir));

  const response = await app.request("http://localhost/projects/demo/preview");
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = /<meta name="hyperframes-project-signature" content="([^"]+)">/.exec(html);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

describe("registerPreviewRoutes", () => {
  it("injects Studio GSAP motion manifest runtime into project preview", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      "<!doctype html><html><head></head><body><div id='card'></div></body></html>",
    );
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "studio-motion.json"),
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"ease":"power2.out","from":{"y":32},"to":{"y":0}}]}`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("__hfStudioMotionApply");
    expect(html).toContain("studio-motion");
    expect(html).toContain("gsap@3.15.0/dist/gsap.min.js");
  });

  it("injects the GSAP CustomEase plugin when Studio motion uses a custom ease", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      "<!doctype html><html><head></head><body><div id='card'></div></body></html>",
    );
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "studio-motion.json"),
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"ease":"studio-card-ease","customEase":{"id":"studio-card-ease","data":"M0,0 C0.18,0.9 0.32,1 1,1"},"from":{"y":32},"to":{"y":0}}]}`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("gsap@3.15.0/dist/gsap.min.js");
    expect(html).toContain("gsap@3.15.0/dist/CustomEase.min.js");
    expect(html.indexOf("gsap.min.js")).toBeLessThan(html.indexOf("CustomEase.min.js"));
    expect(html.indexOf("CustomEase.min.js")).toBeLessThan(html.indexOf("__hfStudioMotionApply"));
  });

  it("injects Studio GSAP motion runtime into sub-composition previews with the active source path", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(
      join(projectDir, "index.html"),
      "<!doctype html><html><head></head><body></body></html>",
    );
    writeFileSync(
      join(projectDir, "compositions/scene.html"),
      `<template><section id="card" data-composition-id="scene" data-width="1280" data-height="720"></section></template>`,
    );
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "studio-motion.json"),
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"compositions/scene.html","id":"card"},"start":0,"duration":1,"ease":"power2.out","from":{"y":32},"to":{"y":0}}]}`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/scene.html",
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("__hfStudioMotionApply");
    expect(html).toContain("compositions/scene.html");
  });

  it("applies adapter preview transforms to bundled root previews", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        bundle: async () => "<!doctype html><html><head></head><body>Preview</body></html>",
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="index.html">');
  });

  it("applies adapter preview transforms to sub-composition previews", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(
      join(projectDir, "compositions/scene.html"),
      `<template><section data-composition-id="scene" data-width="1280" data-height="720"></section></template>`,
    );
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/scene.html",
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="compositions/scene.html">');
  });

  it("applies adapter preview transforms when bundle() returns null (reads from disk)", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        // bundle: async () => null  <-- default; falls back to reading index.html from disk
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="index.html">');
  });

  it("applies adapter preview transforms in the bundle error fallback path", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        bundle: async () => {
          throw new Error("bundler unavailable");
        },
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="index.html">');
  });

  it("falls back to original HTML when transformPreviewHtml throws", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        bundle: async () => "<!doctype html><html><head></head><body>Preview</body></html>",
        transformPreviewHtml: async () => {
          throw new Error("transform failed");
        },
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Preview");
  });

  it("uses the adapter project signature when available", async () => {
    const projectDir = createProjectDir();
    const getProjectSignature = vi.fn(() => "cached-signature");
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir, { getProjectSignature }));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(getProjectSignature).toHaveBeenCalledWith(projectDir);
    expect(html).toContain(
      '<meta name="hyperframes-project-signature" content="cached-signature">',
    );
  });

  it("updates the preview signature after project text edits", async () => {
    const projectDir = createProjectDir();
    const file = join(projectDir, "scene.js");
    writeFileSync(file, "export const label = 'first';");

    const firstSignature = await getPreviewSignature(projectDir);
    expect(await getPreviewSignature(projectDir)).toBe(firstSignature);

    writeFileSync(file, "export const label = 'second with changed size';");

    await expect(getPreviewSignature(projectDir)).resolves.not.toBe(firstSignature);
  });

  it("updates the preview signature after Studio manifest edits", async () => {
    const projectDir = createProjectDir();
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    const motionFile = join(manifestDir, "studio-motion.json");
    writeFileSync(motionFile, `{"version":1,"motions":[]}`);

    const firstSignature = await getPreviewSignature(projectDir);

    writeFileSync(
      motionFile,
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"from":{"y":32},"to":{"y":0}}]}`,
    );

    await expect(getPreviewSignature(projectDir)).resolves.not.toBe(firstSignature);
  });

  it("skips symlinked files when creating the preview signature", async () => {
    const projectDir = createProjectDir();
    const firstSignature = await getPreviewSignature(projectDir);

    const externalDir = mkdtempSync(join(tmpdir(), "hf-preview-external-"));
    tempDirs.push(externalDir);
    const externalFile = join(externalDir, "external.js");
    writeFileSync(externalFile, "export const external = true;");

    if (!tryCreateSymlink(externalFile, join(projectDir, "external.js"), "file")) return;

    await expect(getPreviewSignature(projectDir)).resolves.toBe(firstSignature);
  });

  it("skips symlinked directories when creating the preview signature", async () => {
    const projectDir = createProjectDir();
    if (!tryCreateSymlink(projectDir, join(projectDir, "loop"), "dir")) return;

    const signature = await getPreviewSignature(projectDir);

    expect(signature).toMatch(/^[a-f0-9]{24}$/);
  });
});

describe("hf-id surfacing in preview route", () => {
  it("serves HTML with data-hf-id on body elements (R7 write-back)", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head></head><body><div class="card"><p>text</p></div></body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview");
    expect(res.status).toBe(200);
    const html = await res.text();
    const ids = html.match(/data-hf-id="hf-[a-z0-9]{4}"/g);
    // div and p both tagged
    expect(ids?.length).toBeGreaterThanOrEqual(2);
  });

  it("writes data-hf-id back to disk on first serve", async () => {
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const indexPath = join(projectDir, "index.html");
    writeFileSync(
      indexPath,
      `<!doctype html><html><head></head><body><div>hello</div></body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    await app.request("http://localhost/projects/demo/preview");
    const onDisk = readFileSync(indexPath, "utf-8");
    expect(onDisk).toContain('data-hf-id="hf-');
  });

  it("bundle returning untagged HTML gets same ids as disk — content-hash is stable across mint contexts", async () => {
    // Regression guard for bundle-vs-disk id divergence: if the bundler reads from
    // a pre-write cache snapshot (no ids), ensureHfIds mints ids on the bundle output.
    // Because ids are content-keyed (FNV1a of element content), the minted ids must
    // equal the ids persisted to disk for the same source HTML — otherwise a
    // drag-to-edit patch keyed by a wire-time id would fail to apply on disk.
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const indexPath = join(projectDir, "index.html");
    const sourceHtml = `<!doctype html><html><head></head><body><div class="card"><p>hello</p></div></body></html>`;
    writeFileSync(indexPath, sourceHtml);

    const app = new Hono();
    // Bundler returns the same untagged source HTML (simulates stale cache read)
    registerPreviewRoutes(app, createAdapter(projectDir, { bundle: async () => sourceHtml }));
    const res = await app.request("http://localhost/projects/demo/preview");
    expect(res.status).toBe(200);

    const servedHtml = await res.text();
    const diskHtml = readFileSync(indexPath, "utf-8");

    // Extract ids from served HTML and disk HTML
    const servedIds = [...servedHtml.matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g)].map((m) => m[1]);
    const diskIds = [...diskHtml.matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g)].map((m) => m[1]);

    expect(servedIds.length).toBeGreaterThanOrEqual(2);
    expect(servedIds).toEqual(diskIds);
  });
});
