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
  overrides: Partial<StudioApiAdapter> & { autoProxy?: boolean } = {},
): StudioApiAdapter & { autoProxy?: boolean } {
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

// ── U3: ?hf-proxy=h264 negotiation + __HF_MEDIA_CODEC_MAP__ injection ───────
// (docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md)
//
// Both helpers preview.ts depends on (proxyTranscoder's resolveProxy,
// mediaCodecMap's scanProjectMediaCodecMap) are mocked here rather than
// exercised for real: their own behavior (ffmpeg spawning/caching, ffprobe
// codec detection) is already covered by proxyTranscoder.test.ts and
// mediaCodecMap.test.ts. This suite only tests preview.ts's own wiring —
// the route branches, ETag salting, 404/502 mapping, and injection point.
describe("hf-proxy negotiation and media codec map injection (U3)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../helpers/proxyTranscoder.js");
    vi.doUnmock("../helpers/mediaCodecMap.js");
  });

  class FakeProxyTranscodeError extends Error {
    readonly exitCode: number | null;
    readonly stderrTail: string;
    constructor(message: string, exitCode: number | null, stderrTail: string) {
      super(message);
      this.name = "ProxyTranscodeError";
      this.exitCode = exitCode;
      this.stderrTail = stderrTail;
    }
  }

  class FakeProxyCapacityError extends FakeProxyTranscodeError {}

  type ScanMapImpl = (
    projectDir: string,
    htmlSources: Array<{ html: string; compSrcPath?: string }>,
    options?: unknown,
  ) => Promise<
    Record<
      string,
      {
        codecName: string;
        browserHostile: boolean;
        representativeMime: string | null;
      }
    >
  >;

  async function loadPreviewModule(opts: {
    resolveProxyImpl?: (
      projectDir: string,
      absoluteSourcePath: string,
      variant?: "h264" | "vp8",
    ) => Promise<string>;
    scanMapImpl?: ScanMapImpl;
    probeAssetCodecImpl?: () => Promise<{
      codecName: string;
      browserHostile: boolean;
      representativeMime: string | null;
      hasAlpha: boolean;
    } | null>;
  }): Promise<typeof import("./preview.js")> {
    vi.resetModules();
    const resolveProxy =
      opts.resolveProxyImpl ??
      (async () => {
        throw new FakeProxyTranscodeError(
          "no resolveProxy impl configured for this test",
          null,
          "",
        );
      });
    vi.doMock("../helpers/proxyTranscoder.js", () => ({
      resolveProxy,
      ProxyTranscodeError: FakeProxyTranscodeError,
      ProxyCapacityError: FakeProxyCapacityError,
      PROXY_PARAMS_VERSION: "v1",
      getProxyCachePath: () => "",
    }));
    vi.doMock("../helpers/mediaCodecMap.js", () => ({
      scanProjectMediaCodecMap: opts.scanMapImpl ?? (async () => ({})),
      createMediaCodecProbeCache: () => new Map(),
      probeAssetCodec:
        opts.probeAssetCodecImpl ??
        (async () => ({
          codecName: "hevc",
          browserHostile: true,
          representativeMime: null,
          hasAlpha: false,
        })),
      decideMediaProxyEligibility: (
        facts: {
          browserHostile: boolean;
          hasAlpha: boolean;
        } | null,
      ) => {
        if (!facts) return { eligible: false, reason: "unknown_codec" };
        if (!facts.browserHostile) {
          return { eligible: false, reason: "browser_safe_codec" };
        }
        return { eligible: true };
      },
      isProxyVariant: (value: string) => value === "h264" || value === "vp8",
      isProxyVariantRequest: (value: string) =>
        value === "auto" || value === "h264" || value === "vp8",
      proxyVariantFor: (facts: { hasAlpha: boolean }) => (facts.hasAlpha ? "vp8" : "h264"),
      resolveProxyVariantRequest: (
        request: "auto" | "h264" | "vp8",
        facts: { hasAlpha: boolean },
      ) => {
        const expected = facts.hasAlpha ? "vp8" : "h264";
        return request === "auto" || request === expected ? expected : null;
      },
      PROXY_VARIANT_CONFIG: {
        h264: { extension: ".mp4", contentType: "video/mp4" },
        vp8: { extension: ".webm", contentType: "video/webm" },
      },
    }));
    return import("./preview.js");
  }

  describe("?hf-proxy=h264 on the static asset route", () => {
    it("serves proxy bytes with Accept-Ranges on a full request, and a 206 range slice on a Range request", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.mp4");
        writeFileSync(proxyPath, "0123456789proxybytes");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const full = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(full.status).toBe(200);
      expect(full.headers.get("Accept-Ranges")).toBe("bytes");
      expect(full.headers.get("Content-Type")).toBe("video/mp4");
      expect(await full.text()).toBe("0123456789proxybytes");
      expect(resolveProxyMock).toHaveBeenCalledTimes(1);
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "clip.mp4"),
        "h264",
      );

      const ranged = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
        {
          headers: { Range: "bytes=0-9" },
        },
      );
      expect(ranged.status).toBe(206);
      expect(await ranged.text()).toBe("0123456789");
      expect(ranged.headers.get("Content-Range")).toBe("bytes 0-9/20");
    });

    it("honors If-None-Match on a repeat request with a 304, without re-invoking resolveProxy", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.mp4");
        writeFileSync(proxyPath, "proxy-bytes");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const first = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(first.status).toBe(200);
      const etag = first.headers.get("ETag");
      expect(etag).toBeTruthy();
      expect(resolveProxyMock).toHaveBeenCalledTimes(1);

      const second = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
        { headers: { "If-None-Match": etag! } },
      );
      expect(second.status).toBe(304);
      // The 304 shortcut never needs the proxy — no second transcode call.
      expect(resolveProxyMock).toHaveBeenCalledTimes(1);
    });

    it("returns 404 without transcoding when the asset is missing", async () => {
      const projectDir = createProjectDir();
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/does-not-exist.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("returns 404 without transcoding when the asset is not a video", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "notes.txt"), "just text");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/notes.txt?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("serves an alpha asset as a VP8 WebM proxy", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mov"), "alpha-video-bytes");
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.webm");
        writeFileSync(proxyPath, "vp8-alpha-proxy");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        probeAssetCodecImpl: async () => ({
          codecName: "prores",
          browserHostile: true,
          representativeMime: null,
          hasAlpha: true,
        }),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview/clip.mov?hf-proxy=vp8");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("video/webm");
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "clip.mov"),
        "vp8",
      );
    });

    it("rejects a proxy variant that disagrees with the asset facts", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "video-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview/clip.mp4?hf-proxy=vp8");

      expect(res.status).toBe(422);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("rejects browser-safe sources before transcoding", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "video-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        probeAssetCodecImpl: async () => ({
          codecName: "h264",
          browserHostile: false,
          representativeMime: null,
          hasAlpha: false,
        }),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );

      expect(res.status).toBe(422);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("returns 404 without transcoding when the param value is not a proxy variant", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      for (const value of ["H264", ""]) {
        const res = await app.request(
          `http://localhost/projects/demo/preview/clip.mp4?hf-proxy=${value}`,
        );
        expect(res.status).toBe(404);
      }
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("maps a ProxyTranscodeError to a 502 carrying the error message", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => {
        throw new FakeProxyTranscodeError("ffmpeg exited with code 1", 1, "unsupported codec");
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(502);
      expect(await res.text()).toBe("ffmpeg exited with code 1");
    });

    it("maps a full proxy queue to a retryable 503", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: async () => {
          throw new FakeProxyCapacityError("media proxy queue is full", null, "");
        },
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("5");
    });

    it("rejects a path-traversal attempt through the proxied path (404, no transcode)", async () => {
      const projectDir = createProjectDir();
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/..%2f..%2f..%2fetc%2fpasswd?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("404s the param when auto-proxy is disabled for the adapter, without transcoding", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir, { autoProxy: false }));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });
  });

  describe("__HF_MEDIA_CODEC_MAP__ injection into composition HTML", () => {
    it("keeps HTML byte-identical when the scan finds no proxy-eligible media", async () => {
      const projectDir = createProjectDir();
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        scanMapImpl: async () => ({}),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview");
      const html = await res.text();
      expect(html).not.toContain("data-hf-media-codec-map");
    });
    it("injects the scanned map naming the hostile fixture, and pre-warms resolveProxy for it", async () => {
      const projectDir = createProjectDir();
      const resolveProxyMock = vi.fn(async () => join(projectDir, ".transcode-cache", "x.mp4"));
      const scanMapMock = vi.fn(async () => ({
        "/videos/hevc.mp4": {
          codecName: "hevc",
          browserHostile: true,
          representativeMime: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
        },
      }));
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        scanMapImpl: scanMapMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("window.__HF_MEDIA_CODEC_MAP__");
      expect(html).toContain("/videos/hevc.mp4");
      expect(html).not.toContain("h264.mp4");
      expect(scanMapMock).toHaveBeenCalled();

      // Pre-warm: fire-and-forget resolveProxy for the hostile entry.
      await Promise.resolve();
      await Promise.resolve();
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "/videos/hevc.mp4"),
        "h264",
      );
    });

    it("escapes script terminators and JavaScript line separators in codec-map keys", async () => {
      const projectDir = createProjectDir();
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: async () => join(projectDir, ".transcode-cache", "x.mp4"),
        scanMapImpl: async () => ({
          "/videos/</script>\u2028\u2029.mp4": {
            codecName: "hevc",
            browserHostile: true,
            representativeMime: null,
          },
        }),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const html = await (await app.request("http://localhost/projects/demo/preview")).text();

      const injected = /<script data-hf-media-codec-map>([\s\S]*?)<\/script>/.exec(html)?.[1];
      expect(injected).toContain("\\u003c/script>");
      expect(injected).toContain("\\u2028");
      expect(injected).toContain("\\u2029");
      expect(injected).not.toContain("</script>");
    });

    it("does not inject the codec map (and 404s the proxy param) when auto-proxy is disabled", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const scanMapMock = vi.fn(async () => ({
        "/clip.mp4": {
          codecName: "hevc",
          browserHostile: true,
          representativeMime: null,
        },
      }));
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        scanMapImpl: scanMapMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir, { autoProxy: false }));

      const res = await app.request("http://localhost/projects/demo/preview");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("__HF_MEDIA_CODEC_MAP__");
      expect(scanMapMock).not.toHaveBeenCalled();

      const proxyRes = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(proxyRes.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });
  });
});
