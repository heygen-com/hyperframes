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

  it("injects the GSAP MotionPathPlugin when the composition uses a motionPath", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      </head><body><div id="card" class="clip"></div>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to("#card", { motionPath: { path: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }, duration: 1 }, 0);
          window.__timelines = { index: tl };
        </script>
      </body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    // Plugin version is derived from the composition's own gsap (gsap@3 here).
    expect(html).toContain("gsap@3/dist/MotionPathPlugin.min.js");
    // Plugin must load AFTER the core gsap script so it can register onto it.
    expect(html.indexOf("gsap.min.js")).toBeLessThan(html.indexOf("MotionPathPlugin.min.js"));
  });

  it("does NOT inject MotionPathPlugin when the composition has no motionPath", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      </head><body><div id="card" class="clip"></div>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to("#card", { x: 100, duration: 1 }, 0);
          window.__timelines = { index: tl };
        </script>
      </body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain("MotionPathPlugin.min.js");
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

  it("sub-comp route writes data-hf-id back to disk on first serve", async () => {
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const compPath = join(projectDir, "scene.html");
    writeFileSync(compPath, `<div class="clip" data-start="0" data-end="3">Hi</div>`);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/comp/scene.html");
    expect(res.status).toBe(200);
    expect(readFileSync(compPath, "utf-8")).toContain('data-hf-id="hf-');
  });

  it("sub-comp served ids equal disk ids even when relative asset paths are rewritten", async () => {
    // Regression guard for the setTiming element_not_found divergence class:
    // the sub-comp route rewrites relative src/href BEFORE minting, so an
    // element with a relative asset path got a preview-only id that existed
    // nowhere in the raw file. Persisting ids from the RAW file first pins
    // them; the rewrite then carries the pinned ids through unchanged.
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const compPath = join(projectDir, "scene.html");
    writeFileSync(
      compPath,
      `<div class="clip" data-start="0" data-end="3"><img src="assets/logo.png"></div>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/comp/scene.html");
    expect(res.status).toBe(200);
    const servedIds = [...(await res.text()).matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g)]
      .map((m) => m[1])
      .sort();
    const diskIds = [...readFileSync(compPath, "utf-8").matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(servedIds.length).toBeGreaterThanOrEqual(2); // div + img
    expect(servedIds).toEqual(diskIds);
  });

  it("template-based sub-comp: inner ids persist to disk and match the served (unwrapped) ids", async () => {
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const compPath = join(projectDir, "test-minimal.html");
    writeFileSync(
      compPath,
      `<template data-composition-id="test-minimal"><div class="clip" data-start="0" data-end="3">Hello</div><div class="clip" data-start="3" data-end="6">World</div></template>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/comp/test-minimal.html");
    expect(res.status).toBe(200);
    const servedIds = [...(await res.text()).matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g)].map(
      (m) => m[1],
    );
    const diskIds = [
      ...readFileSync(compPath, "utf-8").matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g),
    ].map((m) => m[1]);
    expect(diskIds.length).toBe(2);
    for (const id of diskIds) expect(servedIds).toContain(id);
  });

  it("sub-comp route does NOT rewrite a non-HTML file on disk (GET must not corrupt assets)", async () => {
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const svgPath = join(projectDir, "logo.svg");
    const svgBytes = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`;
    writeFileSync(svgPath, svgBytes);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    await app.request("http://localhost/projects/demo/preview/comp/logo.svg");
    // Whatever the route serves, a GET must leave the file byte-identical.
    expect(readFileSync(svgPath, "utf-8")).toBe(svgBytes);
  });

  it("sub-comp route does NOT persist ids inside a plain <template> (runtime clone-source)", async () => {
    const { readFileSync } = await import("node:fs");
    const projectDir = createProjectDir();
    const compPath = join(projectDir, "clones.html");
    writeFileSync(
      compPath,
      `<div class="clip" data-start="0" data-end="3">stage</div><template><li class="row">item</li></template>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/comp/clones.html");
    expect(res.status).toBe(200);
    const disk = readFileSync(compPath, "utf-8");
    expect(disk).toMatch(/<div[^>]*data-hf-id/); // stage div stamped
    expect(disk).not.toMatch(/<li[^>]*data-hf-id/); // clone-source untouched
  });
});

describe("preview ?variables= injection", () => {
  it("injects window.__hfVariables before composition scripts in the main preview", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const values = { title: "Custom", count: 5 };
    const res = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent(JSON.stringify(values))}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("data-hf-preview-variables");
    expect(html).toContain('window.__hfVariables={"title":"Custom","count":5}');
    // Injected in <head> — before the runtime script and all body scripts.
    expect(html.indexOf("data-hf-preview-variables")).toBeLessThan(html.indexOf("</head>"));
  });

  it("escapes </script> breakout attempts in string values", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const values = { title: "</script><script>alert(1)</script>" };
    const res = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent(JSON.stringify(values))}`,
    );
    const html = await res.text();
    const injected = /<script data-hf-preview-variables>([\s\S]*?)<\/script>/.exec(html);
    expect(injected?.[1]).toContain("\\u003c/script>");
    expect(injected?.[1]).not.toContain("</script>");
  });

  it("returns 400 for invalid JSON and non-object payloads", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const bad = await app.request("http://localhost/projects/demo/preview?variables=%7Bnope");
    expect(bad.status).toBe(400);
    const arr = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent("[1,2]")}`,
    );
    expect(arr.status).toBe(400);
  });

  it("salts the ETag so cached previews revalidate when values change", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const plain = await app.request("http://localhost/projects/demo/preview");
    const withVars = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent('{"a":1}')}`,
    );
    const otherVars = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent('{"a":2}')}`,
    );
    const etags = [plain, withVars, otherVars].map((r) => r.headers.get("ETag"));
    expect(new Set(etags).size).toBe(3);
  });

  it("injects variables into sub-composition previews", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "scene.html"),
      "<!doctype html><html><head></head><body><div class='clip' data-start='0' data-duration='2'>Scene</div></body></html>",
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const res = await app.request(
      `http://localhost/projects/demo/preview/comp/scene.html?variables=${encodeURIComponent('{"accent":"#f00"}')}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('window.__hfVariables={"accent":"#f00"}');
  });
});

describe("sub-composition preview attribute integrity", () => {
  it("preserves quote-bearing html attributes (data-composition-variables JSON)", async () => {
    const projectDir = createProjectDir();
    const decls = JSON.stringify([
      { id: "title", type: "string", label: "Title", default: "Hello" },
    ]);
    writeFileSync(
      join(projectDir, "card.html"),
      `<!doctype html><html data-composition-variables='${decls}'><head></head><body><div class="clip" data-start="0" data-duration="2">x</div></body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/preview/comp/card.html");
    expect(res.status).toBe(200);
    const html = await res.text();
    const attr = /data-composition-variables="([^"]*)"/.exec(html)?.[1] ?? "";
    // Entities decode back to the exact declared JSON — a lost/shredded
    // attribute here silently breaks getVariables() on the comp route.
    const decoded = attr.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect(JSON.parse(decoded)).toEqual(JSON.parse(decls));
  });
});
