import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-files-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html><body>Preview</body></html>");
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

describe("registerFileRoutes", () => {
  it("returns empty content for missing files when caller marks the read optional", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/files/missing-file.txt?optional=1",
    );
    const payload = (await response.json()) as { filename?: string; content?: string };

    expect(response.status).toBe(200);
    expect(payload.filename).toBe("missing-file.txt");
    expect(payload.content).toBe("");
  });

  it("still returns 404 for other missing files", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/files/missing-file.txt");

    expect(response.status).toBe(404);
  });

  // A realistic sub-composition: markup + GSAP wrapped in a <template>, tweens
  // targeting element variables resolved from querySelector, with interleaved
  // gsap.set() calls. This is the shape every scaffolded composition uses.
  const TEMPLATE_COMP = `<template id="scene-template">
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080" data-start="0" data-duration="3">
    <div class="kicker">HELLO</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    (function () {
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const root = document.querySelector('#scene');
      const kicker = root.querySelector(".kicker");
      gsap.set(kicker, { y: 16, opacity: 0 });
      tl.to(kicker, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, 0.3);
      window.__timelines["scene"] = tl;
    })();
  </script>
</template>`;

  function writeComp(projectDir: string, name: string, html: string): void {
    const dir = join(projectDir, "compositions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), html);
  }

  it("parses GSAP tweens from a <template>-wrapped sub-composition with variable targets", async () => {
    const projectDir = createProjectDir();
    writeComp(projectDir, "scene.html", TEMPLATE_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/gsap-animations/compositions/scene.html",
    );
    const payload = (await response.json()) as {
      animations: Array<{ id: string; targetSelector: string; properties: Record<string, number> }>;
    };

    expect(response.status).toBe(200);
    expect(payload.animations).toHaveLength(1);
    expect(payload.animations[0].targetSelector).toBe(".kicker");
  });

  it("edits a template-wrapped tween in place, preserving gsap.set and the IIFE", async () => {
    const projectDir = createProjectDir();
    writeComp(projectDir, "scene.html", TEMPLATE_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const parseRes = await app.request(
      "http://localhost/projects/demo/gsap-animations/compositions/scene.html",
    );
    const { animations } = (await parseRes.json()) as { animations: Array<{ id: string }> };
    const animationId = animations[0].id;

    const mutateRes = await app.request(
      "http://localhost/projects/demo/gsap-mutations/compositions/scene.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "update-property",
          animationId,
          property: "opacity",
          value: 0.5,
        }),
      },
    );
    const result = (await mutateRes.json()) as { ok: boolean; after: string };

    expect(mutateRes.status).toBe(200);
    expect(result.ok).toBe(true);
    // Edit landed
    expect(result.after).toContain("opacity: 0.5");
    // Surrounding code preserved verbatim — the in-place AST edit didn't rewrite the block
    expect(result.after).toContain("gsap.set(kicker, { y: 16, opacity: 0 })");
    expect(result.after).toContain('const kicker = root.querySelector(".kicker")');
    expect(result.after).toContain('window.__timelines["scene"] = tl;');
    expect(result.after).toContain("(function () {");
    // The variable target was not flattened to a string-literal selector
    expect(result.after).toContain("tl.to(kicker,");
  });
});
