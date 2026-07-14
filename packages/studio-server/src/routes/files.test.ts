import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitElementPatchBatches, registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

const recastImportGate = vi.hoisted<{
  wait: Promise<void> | null;
  onEnter: (() => void) | null;
}>(() => ({ wait: null, onEnter: null }));

vi.mock("@hyperframes/parsers/gsap-parser-recast", async (importOriginal) => {
  recastImportGate.onEnter?.();
  if (recastImportGate.wait) await recastImportGate.wait;
  return importOriginal();
});

const tempDirs: string[] = [];

afterEach(() => {
  recastImportGate.wait = null;
  recastImportGate.onEnter = null;
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

function postElementPatchBatch(app: Hono, file: string, patches: unknown[]): Promise<Response> {
  return app.request(`http://localhost/projects/demo/file-mutations/patch-elements-batch/${file}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });
}

function postElementPatchBatches(
  app: Hono,
  batches: Array<{ sourceFile: string; patches: unknown[] }>,
): Promise<Response> {
  return app.request("http://localhost/projects/demo/file-mutations/patch-element-batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batches }),
  });
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

  it("backs up the previous file content before PUT overwrite", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "index.html"), "before");
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/files/index.html", {
      method: "PUT",
      body: "after",
    });
    const payload = (await response.json()) as { path?: string; backupPath?: string };

    expect(response.status).toBe(200);
    expect(payload.path).toBe("index.html");
    expect(payload.backupPath).toMatch(/^\.hyperframes\/backup\//);
    expect(readFileSync(join(projectDir, payload.backupPath!), "utf-8")).toBe("before");
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe("after");
  });

  it("backs up the previous file content before delete", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "index.html"), "before delete");
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/files/index.html", {
      method: "DELETE",
    });
    const payload = (await response.json()) as { backupPath?: string };

    expect(response.status).toBe(200);
    expect(payload.backupPath).toMatch(/^\.hyperframes\/backup\//);
    expect(readFileSync(join(projectDir, payload.backupPath!), "utf-8")).toBe("before delete");
  });

  it("backs up the previous file content before structured DOM mutations", async () => {
    const projectDir = createProjectDir();
    writeFileSync(projectDir + "/index.html", '<div id="title">Before</div>');
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { id: "title" },
          operations: [{ type: "text-content", property: "textContent", value: "After" }],
        }),
      },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      changed?: boolean;
      path?: string;
      backupPath?: string;
    };

    expect(payload.changed).toBe(true);
    expect(payload.path).toBe("index.html");
    expect(payload.backupPath).toMatch(/^\.hyperframes\/backup\//);
    expect(readFileSync(join(projectDir, payload.backupPath!), "utf-8")).toBe(
      '<div id="title">Before</div>',
    );
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toContain("After");
  });

  it("applies an ordered element patch batch with one file write", async () => {
    const projectDir = createProjectDir();
    const original =
      '<div id="back" style="z-index: 1">Back</div><div id="front" style="z-index: 2">Front</div>';
    writeFileSync(join(projectDir, "index.html"), original);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postElementPatchBatch(app, "index.html", [
      {
        target: { id: "back" },
        operations: [{ type: "inline-style", property: "z-index", value: "2" }],
      },
      {
        target: { id: "front" },
        operations: [{ type: "inline-style", property: "z-index", value: "1" }],
      },
    ]);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      changed?: boolean;
      matched?: boolean[];
      content?: string;
      backupPath?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(true);
    expect(payload.matched).toEqual([true, true]);
    expect(payload.content).toBe(readFileSync(join(projectDir, "index.html"), "utf-8"));
    expect(payload.content).toContain('id="back" style="z-index: 2"');
    expect(payload.content).toContain('id="front" style="z-index: 1"');
    expect(readFileSync(join(projectDir, payload.backupPath!), "utf-8")).toBe(original);
    expect(readdirSync(join(projectDir, ".hyperframes", "backup"))).toHaveLength(1);
  });

  it("returns changed false without writing for a no-op element patch batch", async () => {
    const projectDir = createProjectDir();
    const original = '<div id="title" style="z-index: 4">Title</div>';
    writeFileSync(join(projectDir, "index.html"), original);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postElementPatchBatch(app, "index.html", [
      {
        target: { id: "title" },
        operations: [{ type: "inline-style", property: "z-index", value: "4" }],
      },
    ]);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      changed?: boolean;
      matched?: boolean[];
      content?: string;
      backupPath?: string;
    };

    expect(payload.changed).toBe(false);
    expect(payload.matched).toEqual([true]);
    expect(payload.content).toBe(original);
    expect(payload.backupPath).toBeUndefined();
    expect(existsSync(join(projectDir, ".hyperframes", "backup"))).toBe(false);
  });

  it("refuses the whole element batch when any target is unmatched", async () => {
    const projectDir = createProjectDir();
    const original = '<div id="present" style="z-index: 1">Present</div>';
    writeFileSync(join(projectDir, "index.html"), original);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postElementPatchBatch(app, "index.html", [
      {
        target: { id: "present" },
        operations: [{ type: "inline-style", property: "z-index", value: "2" }],
      },
      {
        target: { id: "missing" },
        operations: [{ type: "inline-style", property: "z-index", value: "3" }],
      },
    ]);
    const payload = (await response.json()) as {
      changed?: boolean;
      matched?: boolean[];
      content?: string;
      backupPath?: string;
    };

    expect(payload).toMatchObject({ changed: false, matched: [true, false], content: original });
    expect(payload.backupPath).toBeUndefined();
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(original);
    expect(existsSync(join(projectDir, ".hyperframes", "backup"))).toBe(false);
  });

  it("refuses every file when one batch contains an unmatched target", async () => {
    const projectDir = createProjectDir();
    const indexOriginal = '<div id="present" style="z-index: 1">Present</div>';
    const sceneOriginal = '<div id="scene" style="z-index: 1">Scene</div>';
    writeFileSync(join(projectDir, "index.html"), indexOriginal);
    writeFileSync(join(projectDir, "scene.html"), sceneOriginal);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postElementPatchBatches(app, [
      {
        sourceFile: "index.html",
        patches: [
          {
            target: { id: "present" },
            operations: [{ type: "inline-style", property: "z-index", value: "2" }],
          },
        ],
      },
      {
        sourceFile: "scene.html",
        patches: [
          {
            target: { id: "missing" },
            operations: [{ type: "inline-style", property: "z-index", value: "3" }],
          },
        ],
      },
    ]);
    const payload = (await response.json()) as {
      durable?: boolean;
      files?: Array<{
        sourceFile?: string;
        changed?: boolean;
        matched?: boolean[];
        before?: string;
        after?: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      durable: false,
      files: [
        {
          sourceFile: "index.html",
          changed: false,
          matched: [true],
          before: indexOriginal,
          after: indexOriginal,
        },
        {
          sourceFile: "scene.html",
          changed: false,
          matched: [false],
          before: sceneOriginal,
          after: sceneOriginal,
        },
      ],
    });
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(indexOriginal);
    expect(readFileSync(join(projectDir, "scene.html"), "utf-8")).toBe(sceneOriginal);
    expect(existsSync(join(projectDir, ".hyperframes", "backup"))).toBe(false);
  });

  it("restores earlier files when a later atomic batch write fails", () => {
    const projectDir = createProjectDir();
    const indexOriginal = '<div id="index" style="z-index: 1">Index</div>';
    const sceneOriginal = '<div id="scene" style="z-index: 1">Scene</div>';
    const indexPath = join(projectDir, "index.html");
    const scenePath = join(projectDir, "scene.html");
    writeFileSync(indexPath, indexOriginal);
    writeFileSync(scenePath, sceneOriginal);
    let remainingFailures = 1;
    const writeFile = (path: string, content: string, encoding: "utf-8") => {
      if (path === scenePath && remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("forced write failure");
      }
      writeFileSync(path, content, encoding);
    };

    expect(() =>
      commitElementPatchBatches(
        projectDir,
        [
          {
            sourceFile: "index.html",
            patches: [
              {
                target: { id: "index" },
                operations: [{ type: "inline-style", property: "z-index", value: "2" }],
              },
            ],
          },
          {
            sourceFile: "scene.html",
            patches: [
              {
                target: { id: "scene" },
                operations: [{ type: "inline-style", property: "z-index", value: "3" }],
              },
            ],
          },
        ],
        writeFile,
      ),
    ).toThrow("forced write failure");
    expect(readFileSync(indexPath, "utf-8")).toBe(indexOriginal);
    expect(readFileSync(scenePath, "utf-8")).toBe(sceneOriginal);
  });

  it("rejects an unsafe value anywhere in an element patch batch without writing", async () => {
    const projectDir = createProjectDir();
    const original = '<div id="first">First</div><div id="second">Second</div>';
    writeFileSync(join(projectDir, "index.html"), original);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postElementPatchBatch(app, "index.html", [
      {
        target: { id: "first" },
        operations: [{ type: "inline-style", property: "z-index", value: "2" }],
      },
      {
        target: { id: "second", selectorIndex: Number.NaN },
        operations: [{ type: "inline-style", property: "z-index", value: "1" }],
      },
    ]);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string; fields?: string[] };

    expect(payload.error).toContain("unsafe values");
    expect(payload.fields).toContain("body.target.selectorIndex");
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(original);
    expect(existsSync(join(projectDir, ".hyperframes", "backup"))).toBe(false);
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

  // A composition with a fromTo tween — used by the fromProperties mutation tests.
  const FROMTO_COMP = `<!DOCTYPE html><html><body data-duration="3">
<div id="box" data-start="0" data-duration="3" style="opacity:0"></div>
<script data-hyperframes-gsap>
const tl = gsap.timeline();
tl.fromTo("#box", { opacity: 0, x: -50 }, { opacity: 1, x: 0, duration: 1.5, ease: "power2.out" }, 0);
</script>
</body></html>`;

  function writeHtml(projectDir: string, name: string, html: string): void {
    writeFileSync(join(projectDir, name), html);
  }

  async function getFirstAnimation(
    app: Hono,
    file: string,
  ): Promise<{ id: string; method: string; fromProperties?: Record<string, number | string> }> {
    const res = await app.request(`http://localhost/projects/demo/gsap-animations/${file}`);
    const payload = (await res.json()) as {
      animations: Array<{
        id: string;
        method: string;
        fromProperties?: Record<string, number | string>;
      }>;
    };
    return payload.animations[0];
  }

  function postGsapMutationBatch(app: Hono, file: string, body: unknown): Promise<Response> {
    return app.request(`http://localhost/projects/demo/gsap-mutations-batch/${file}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function postGsapRollback(
    app: Hono,
    file: string,
    expected: string,
    restore: string,
  ): Promise<Response> {
    return app.request(`http://localhost/projects/demo/gsap-mutation-rollback/${file}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected, restore }),
    });
  }

  it("advertises atomic GSAP ownership before clients mutate", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/gsap-mutation-capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ atomicOwnershipPairs: true });
  });

  it("rejects a stale semantic no-op after a concurrent file write", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", FROMTO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));
    const successor = FROMTO_COMP.replace('data-duration="3"', 'data-duration="9"');
    let releaseImport = () => {};
    recastImportGate.wait = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const parserEntered = new Promise<void>((resolve) => {
      recastImportGate.onEnter = resolve;
    });

    const pending = postGsapMutationBatch(app, "comp.html", {
      mutations: [{ type: "shift-positions", targetSelector: "#missing", delta: 1 }],
    });
    await parserEntered;
    writeHtml(projectDir, "comp.html", successor);
    releaseImport();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ conflict: true });
    expect(readFileSync(join(projectDir, "comp.html"), "utf-8")).toBe(successor);
  });

  it("applies an ordered GSAP mutation batch with one before/after write result", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", FROMTO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));
    const anim = await getFirstAnimation(app, "comp.html");

    const res = await postGsapMutationBatch(app, "comp.html", {
      mutations: [
        {
          type: "update-from-property",
          animationId: anim.id,
          property: "opacity",
          value: 0.2,
        },
        {
          type: "update-from-property",
          animationId: anim.id,
          property: "x",
          value: -25,
        },
      ],
    });
    const result = (await res.json()) as {
      ok: boolean;
      changed: boolean;
      before: string;
      after: string;
      backupPath: string;
      parsed: { animations: Array<{ fromProperties?: Record<string, number | string> }> };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.before).toBe(FROMTO_COMP);
    expect(result.after).toBe(readFileSync(join(projectDir, "comp.html"), "utf-8"));
    expect(readFileSync(join(projectDir, result.backupPath), "utf-8")).toBe(FROMTO_COMP);
    expect(result.parsed.animations[0].fromProperties).toMatchObject({ opacity: 0.2, x: -25 });
  });

  it("conditionally restores the exact GSAP mutation output", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", "MUTATED");
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postGsapRollback(app, "comp.html", "MUTATED", "BEFORE");
    const result = (await response.json()) as { restored: boolean; conflict: boolean };

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ restored: true, conflict: false });
    expect(readFileSync(join(projectDir, "comp.html"), "utf-8")).toBe("BEFORE");
  });

  it("reports a rollback conflict and preserves a successor write", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", "SUCCESSOR");
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await postGsapRollback(app, "comp.html", "MUTATED", "BEFORE");
    const result = (await response.json()) as { restored: boolean; conflict: boolean };

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ restored: false, conflict: true });
    expect(readFileSync(join(projectDir, "comp.html"), "utf-8")).toBe("SUCCESSOR");
  });

  it.each(["first", "middle", "last"] as const)(
    "rejects an invalid %s mutation without writing any part of the batch",
    async (position) => {
      const projectDir = createProjectDir();
      writeHtml(projectDir, "comp.html", FROMTO_COMP);
      const app = new Hono();
      registerFileRoutes(app, createAdapter(projectDir));
      const anim = await getFirstAnimation(app, "comp.html");
      const valid = {
        type: "update-from-property",
        animationId: anim.id,
        property: "opacity",
        value: 0.2,
      };
      const invalid =
        position === "first"
          ? {}
          : position === "middle"
            ? { ...valid, value: null }
            : { type: "not-a-mutation" };
      const mutations =
        position === "first"
          ? [invalid, valid, valid]
          : position === "middle"
            ? [valid, invalid, valid]
            : [valid, valid, invalid];

      const res = await postGsapMutationBatch(app, "comp.html", { mutations });

      expect(res.status).toBe(400);
      expect(readFileSync(join(projectDir, "comp.html"), "utf-8")).toBe(FROMTO_COMP);
    },
  );

  it("re-syncs position holds when a batch mixes hold-sync and ordinary mutations", async () => {
    const projectDir = createProjectDir();
    const html = `<!DOCTYPE html><html><body><div id="box"></div><script data-hyperframes-gsap>
const tl = gsap.timeline({ paused: true });
</script></body></html>`;
    writeHtml(projectDir, "hold.html", html);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await postGsapMutationBatch(app, "hold.html", {
      mutations: [
        {
          type: "add-with-keyframes",
          targetSelector: "#box",
          position: 1,
          duration: 1,
          keyframes: [
            { percentage: 0, properties: { x: 10, y: 20 } },
            { percentage: 100, properties: { x: 30, y: 40 } },
          ],
        },
        {
          type: "add",
          targetSelector: "#box",
          method: "set",
          position: 0,
          properties: { opacity: 0.5 },
        },
      ],
    });
    const result = (await res.json()) as { scriptText: string };

    expect(res.status).toBe(200);
    expect(result.scriptText).toContain("hf-hold");
    expect(result.scriptText.match(/hf-hold/g)).toHaveLength(1);
  });

  it.each([{}, { mutations: [] }])("rejects an empty or missing mutation batch", async (body) => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await postGsapMutationBatch(app, "index.html", body);

    expect(res.status).toBe(400);
  });

  it("update-from-property updates a fromTo start value in place", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", FROMTO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "comp.html");
    expect(anim.method).toBe("fromTo");
    expect(anim.fromProperties?.opacity).toBe(0);

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/comp.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "update-from-property",
        animationId: anim.id,
        property: "opacity",
        value: 0.2,
      }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      mutated?: boolean;
      after: string;
      parsed: { animations: Array<{ fromProperties?: Record<string, number | string> }> };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.mutated).toBe(true);
    expect(result.after).toContain("opacity: 0.2");
    expect(result.parsed.animations[0].fromProperties?.opacity).toBe(0.2);
    // x unchanged
    expect(result.parsed.animations[0].fromProperties?.x).toBe(-50);
  });

  it("reports no GSAP mutation when shifting positions in a file with no GSAP script", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/index.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift-positions",
        targetSelector: "#box",
        delta: 1,
      }),
    });
    const result = (await res.json()) as {
      ok?: boolean;
      changed?: boolean;
      mutated?: boolean;
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.mutated).toBe(false);
  });

  it("consolidate-position-writes leaves exactly one position write per selector", async () => {
    const projectDir = createProjectDir();
    const CORRUPTED = `<!DOCTYPE html><html><body><script data-hyperframes-gsap>
const tl = gsap.timeline({ paused: true });
tl.to("#box", { duration: 0, x: -766, y: 314, immediateRender: true }, 1.333);
gsap.set("#box", { x: -520, y: 170 });
gsap.set("#box", { rotation: 45 });
</script></body></html>`;
    writeHtml(projectDir, "dup.html", CORRUPTED);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/dup.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "consolidate-position-writes", targetSelector: "#box" }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      parsed: {
        animations: Array<{
          targetSelector: string;
          propertyGroup?: string;
          properties: Record<string, unknown>;
        }>;
      };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    const posWrites = result.parsed.animations.filter(
      (a) => a.targetSelector === "#box" && a.propertyGroup === "position",
    );
    expect(posWrites).toHaveLength(1);
    // The non-position rotation set is untouched.
    expect(
      result.parsed.animations.some(
        (a) => a.targetSelector === "#box" && "rotation" in a.properties,
      ),
    ).toBe(true);
  });

  it("rejects serialized non-finite mutation values before writing source", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", FROMTO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "comp.html");
    const before = readFileSync(join(projectDir, "comp.html"), "utf-8");
    const res = await app.request("http://localhost/projects/demo/gsap-mutations/comp.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "update-property",
        animationId: anim.id,
        property: "x",
        value: Number.NaN,
      }),
    });
    const payload = (await res.json()) as { error?: string; fields?: string[] };

    expect(res.status).toBe(400);
    expect(payload.error).toContain("unsafe values");
    expect(payload.fields).toContain("body.value");
    expect(readFileSync(join(projectDir, "comp.html"), "utf-8")).toBe(before);
  });

  it("rejects unsafe DOM patch metadata before writing source", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "index.html"), '<div id="title">Before</div>');
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { id: "title", selectorIndex: Number.NaN },
          operations: [{ type: "text-content", property: "textContent", value: "After" }],
        }),
      },
    );
    const payload = (await response.json()) as { error?: string; fields?: string[] };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("unsafe values");
    expect(payload.fields).toContain("body.target.selectorIndex");
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(
      '<div id="title">Before</div>',
    );
  });

  it("allows DOM patch null values used for explicit style removals", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      '<div id="title" style="opacity: 1">Before</div>',
    );
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { id: "title" },
          operations: [{ type: "inline-style", property: "opacity", value: null }],
        }),
      },
    );
    const payload = (await response.json()) as { changed?: boolean; content?: string };

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(true);
    expect(payload.content).not.toContain("opacity");
  });

  // ── Canvas z-order / patch-target regression suite ────────────────────────
  // A right-click "move to back" on an id-less element (e.g. a caption `.sub`
  // div) once serialized `target.id: null`, which findUnsafeDomPatchValues
  // rejected as `body.target.id`, bricking the edit. The RULE: `target.id` is
  // metadata, not a layout value — a null there is genuinely invalid and stays
  // rejected; the fix is that the client omits an absent id instead of sending
  // null, so the patch degrades to a hfId / selector + selectorIndex match.
  it("rejects a null target.id in a DOM patch (documents the rule)", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      '<div class="sub" style="z-index: 1">A</div><div class="sub" style="z-index: 2">B</div>',
    );
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const before = readFileSync(join(projectDir, "index.html"), "utf-8");
    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { id: null, selector: ".sub", selectorIndex: 1 },
          operations: [{ type: "inline-style", property: "z-index", value: "0" }],
        }),
      },
    );
    const payload = (await response.json()) as { error?: string; fields?: string[] };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("unsafe values");
    expect(payload.fields).toContain("body.target.id");
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe(before);
  });

  it("z-reorder with an omitted id degrades to a selector patch (id-less element)", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      '<div class="sub" style="z-index: 1">A</div><div class="sub" style="z-index: 2">B</div>',
    );
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // id omitted (undefined) — the fixed client shape for an id-less element.
        body: JSON.stringify({
          target: { selector: ".sub", selectorIndex: 1 },
          operations: [{ type: "inline-style", property: "z-index", value: "0" }],
        }),
      },
    );
    const payload = (await response.json()) as { changed?: boolean; content?: string };

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(true);
    // The SECOND `.sub` (selectorIndex 1) is the one restacked, not the first.
    expect(payload.content).toContain('<div class="sub" style="z-index: 1">A</div>');
    expect(payload.content).toContain("z-index: 0");
  });

  it("duplicate-id document: a selector+index patch hits the right element, not a rejection", async () => {
    const projectDir = createProjectDir();
    // Two elements share id="main" AND class="root" (mirrors the user's project,
    // where sub-compositions each carry id="main"). Match by selector + index.
    writeFileSync(
      join(projectDir, "index.html"),
      '<div class="root" id="main" style="z-index: 5">first</div>' +
        '<div class="root" id="main" style="z-index: 6">second</div>',
    );
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { selector: ".root", selectorIndex: 1 },
          operations: [{ type: "inline-style", property: "z-index", value: "0" }],
        }),
      },
    );
    const payload = (await response.json()) as { changed?: boolean; content?: string };

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(true);
    // First "main" untouched; second one restacked.
    expect(payload.content).toContain('<div class="root" id="main" style="z-index: 5">first</div>');
    expect(payload.content).toContain("z-index: 0");
  });

  // Sibling canvas commits (position / size / text) carry real string ids like
  // "v-hero" / "vo-part1" / "main". The guard must accept them — it only rejects
  // null / non-finite numbers, never inspects the id string — so these never hit
  // the z-order "unsafe values" variant.
  it.each([
    {
      label: "position",
      id: "v-hero",
      op: { type: "inline-style", property: "left", value: "40px" },
    },
    {
      label: "size",
      id: "vo-part1",
      op: { type: "inline-style", property: "width", value: "320px" },
    },
    {
      label: "text",
      id: "main",
      op: { type: "text-content", property: "textContent", value: "Hi" },
    },
  ])("accepts a $label commit with a real fixture id ($id)", async ({ id, op }) => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "index.html"), `<div id="${id}">x</div>`);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/index.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: { id }, operations: [op] }),
      },
    );
    const payload = (await response.json()) as { changed?: boolean; error?: string };

    expect(response.status).toBe(200);
    expect(payload.error).toBeUndefined();
    expect(payload.changed).toBe(true);
  });

  it("update-from-property returns 400 for a non-fromTo animation", async () => {
    const projectDir = createProjectDir();
    const TO_COMP = `<!DOCTYPE html><html><body><script data-hyperframes-gsap>
const tl = gsap.timeline();
tl.to("#box", { opacity: 1, duration: 1 }, 0);
</script></body></html>`;
    writeHtml(projectDir, "to.html", TO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "to.html");
    expect(anim.method).toBe("to");

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/to.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "update-from-property",
        animationId: anim.id,
        property: "opacity",
        value: 0,
      }),
    });

    expect(res.status).toBe(400);
  });

  it("add-from-property merges a new key into existing fromProperties", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", FROMTO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "comp.html");

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/comp.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "add-from-property",
        animationId: anim.id,
        property: "scale",
        defaultValue: 0.5,
      }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      parsed: { animations: Array<{ fromProperties?: Record<string, number | string> }> };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    // Existing keys preserved, new key added
    const fp = result.parsed.animations[0].fromProperties ?? {};
    expect(fp.opacity).toBe(0);
    expect(fp.x).toBe(-50);
    expect(fp.scale).toBe(0.5);
  });

  it("remove-from-property deletes one key, leaving others intact", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "comp.html", FROMTO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "comp.html");

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/comp.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "remove-from-property",
        animationId: anim.id,
        property: "x",
      }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      after: string;
      parsed: { animations: Array<{ fromProperties?: Record<string, number | string> }> };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    const fp = result.parsed.animations[0].fromProperties ?? {};
    expect(fp.x).toBeUndefined();
    expect(fp.opacity).toBe(0); // untouched
  });

  // Object-form keyframes — exercises the move-keyframe (retime) route.
  const KEYFRAME_COMP = `<!DOCTYPE html><html><body data-duration="3">
<div id="box" data-start="0" data-duration="3"></div>
<script data-hyperframes-gsap>
const tl = gsap.timeline();
tl.to("#box", { keyframes: { "0%": { x: 0 }, "50%": { x: 100, opacity: 0.5, ease: "power2.in" }, "100%": { x: 200 } }, duration: 1.5 }, 0);
</script>
</body></html>`;

  it("move-keyframe retimes a keyframe, preserving its value + ease", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "kf.html", KEYFRAME_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "kf.html");

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/kf.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "move-keyframe",
        animationId: anim.id,
        fromPercentage: 50,
        toPercentage: 75,
      }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      changed: boolean;
      parsed: {
        animations: Array<{
          keyframes?: {
            keyframes: Array<{
              percentage: number;
              properties: Record<string, number | string>;
              ease?: string;
            }>;
          };
        }>;
      };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    const kfs = result.parsed.animations[0].keyframes?.keyframes ?? [];
    expect(kfs.map((k) => k.percentage)).toEqual([0, 75, 100]);
    const moved = kfs.find((k) => k.percentage === 75)!;
    expect(moved.properties).toEqual({ x: 100, opacity: 0.5 });
    expect(moved.ease).toBe("power2.in");
  });

  it("move-keyframe rejects non-finite percentages before writing source", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "kf.html", KEYFRAME_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "kf.html");
    const before = readFileSync(join(projectDir, "kf.html"), "utf-8");
    const res = await app.request("http://localhost/projects/demo/gsap-mutations/kf.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "move-keyframe",
        animationId: anim.id,
        fromPercentage: 50,
        toPercentage: Number.NaN,
      }),
    });

    expect(res.status).toBe(400);
    expect(readFileSync(join(projectDir, "kf.html"), "utf-8")).toBe(before);
  });

  it("resize-keyframed-tween grows the window + re-keys, preserving value + ease", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "kf.html", KEYFRAME_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "kf.html");

    // Window [0, 1.5]; drag the last keyframe (abs 1.5) out to abs 3 → [0, 3].
    // abs 0/0.75/3 over the new 3s window → 0 / 25 / 100.
    const res = await app.request("http://localhost/projects/demo/gsap-mutations/kf.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "resize-keyframed-tween",
        animationId: anim.id,
        position: 0,
        duration: 3,
        pctRemap: [
          { from: 0, to: 0 },
          { from: 50, to: 25 },
          { from: 100, to: 100 },
        ],
      }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      changed: boolean;
      parsed: {
        animations: Array<{
          duration?: number;
          keyframes?: {
            keyframes: Array<{
              percentage: number;
              properties: Record<string, number | string>;
              ease?: string;
            }>;
          };
        }>;
      };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.parsed.animations[0].duration).toBe(3);
    const kfs = result.parsed.animations[0].keyframes?.keyframes ?? [];
    expect(kfs.map((k) => k.percentage)).toEqual([0, 25, 100]);
    const interior = kfs.find((k) => k.percentage === 25)!;
    expect(interior.properties).toEqual({ x: 100, opacity: 0.5 });
    expect(interior.ease).toBe("power2.in");
  });

  it("resize-keyframed-tween rejects non-finite numbers before writing source", async () => {
    const projectDir = createProjectDir();
    writeHtml(projectDir, "kf.html", KEYFRAME_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "kf.html");
    const before = readFileSync(join(projectDir, "kf.html"), "utf-8");
    const res = await app.request("http://localhost/projects/demo/gsap-mutations/kf.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "resize-keyframed-tween",
        animationId: anim.id,
        position: 0,
        duration: Number.NaN,
        pctRemap: [{ from: 0, to: 0 }],
      }),
    });

    expect(res.status).toBe(400);
    expect(readFileSync(join(projectDir, "kf.html"), "utf-8")).toBe(before);
  });

  it("remove-from-property returns 400 for a non-fromTo animation", async () => {
    const projectDir = createProjectDir();
    const TO_COMP = `<!DOCTYPE html><html><body><script data-hyperframes-gsap>
const tl = gsap.timeline();
tl.to("#box", { opacity: 1, duration: 1 }, 0);
</script></body></html>`;
    writeHtml(projectDir, "to.html", TO_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "to.html");

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/to.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "remove-from-property",
        animationId: anim.id,
        property: "opacity",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("add mutation with fromTo method creates a fromTo tween with fromProperties", async () => {
    const projectDir = createProjectDir();
    const EMPTY_COMP = `<!DOCTYPE html><html><body><div id="el"></div><script data-hyperframes-gsap>
const tl = gsap.timeline();
</script></body></html>`;
    writeHtml(projectDir, "empty.html", EMPTY_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/empty.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "add",
        targetSelector: "#el",
        method: "fromTo",
        position: 0,
        duration: 0.5,
        ease: "power2.out",
        properties: { opacity: 1 },
        fromProperties: { opacity: 0 },
      }),
    });
    const result = (await res.json()) as {
      ok: boolean;
      parsed: {
        animations: Array<{
          method: string;
          fromProperties?: Record<string, number | string>;
          properties: Record<string, number | string>;
        }>;
      };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    const anim = result.parsed.animations[0];
    expect(anim.method).toBe("fromTo");
    expect(anim.fromProperties?.opacity).toBe(0);
    expect(anim.properties.opacity).toBe(1);
  });

  it("add mutation returns 400 when fromProperties provided for non-fromTo method", async () => {
    const projectDir = createProjectDir();
    const EMPTY_COMP = `<!DOCTYPE html><html><body><div id="el"></div><script data-hyperframes-gsap>
const tl = gsap.timeline();
</script></body></html>`;
    writeHtml(projectDir, "empty.html", EMPTY_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/empty.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "add",
        targetSelector: "#el",
        method: "to",
        position: 0,
        duration: 0.5,
        ease: "power2.out",
        properties: { opacity: 1 },
        fromProperties: { opacity: 0 },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("fromProperties");
  });

  // A rotation-only keyframe set must strip the legacy studio rotation channel just
  // as a position keyframe set strips the offset channel — otherwise --hf-studio-rotation
  // double-applies on top of the new GSAP rotation tween.
  it("replace-with-keyframes strips studio rotation edits for a rotation-only keyframe set", async () => {
    const projectDir = createProjectDir();
    const ROT_COMP = `<!DOCTYPE html><html><body data-duration="3">
<div id="box" data-start="0" data-duration="3" data-hf-studio-rotation="30" style="--hf-studio-rotation:30deg;rotate:30deg"></div>
<script data-hyperframes-gsap>
const tl = gsap.timeline();
tl.to("#box", { opacity: 1, duration: 1 }, 0);
</script>
</body></html>`;
    writeHtml(projectDir, "rot.html", ROT_COMP);
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const anim = await getFirstAnimation(app, "rot.html");
    const res = await app.request("http://localhost/projects/demo/gsap-mutations/rot.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "replace-with-keyframes",
        animationId: anim.id,
        targetSelector: "#box",
        position: 0,
        duration: 1,
        keyframes: [
          { percentage: 0, properties: { rotation: 0 } },
          { percentage: 100, properties: { rotation: 90 } },
        ],
      }),
    });
    const result = (await res.json()) as { ok: boolean; after: string };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.after).not.toContain("--hf-studio-rotation");
    expect(result.after).not.toContain("data-hf-studio-rotation");
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

  it("shift-positions-batch equals sequential single shifts (atomic multi-clip)", async () => {
    const TWO_TWEENS = `<!DOCTYPE html><html><body><script data-hyperframes-gsap>
const tl = gsap.timeline({ paused: true });
tl.to("#a", { duration: 1, x: 100 }, 1);
tl.to("#b", { duration: 1, x: 200 }, 2);
</script></body></html>`;

    const seqDir = createProjectDir();
    writeHtml(seqDir, "seq.html", TWO_TWEENS);
    const seqApp = new Hono();
    registerFileRoutes(seqApp, createAdapter(seqDir));
    await seqApp.request("http://localhost/projects/demo/gsap-mutations/seq.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shift-positions", targetSelector: "#a", delta: 1 }),
    });
    const seqRes = await seqApp.request("http://localhost/projects/demo/gsap-mutations/seq.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shift-positions", targetSelector: "#b", delta: 0.5 }),
    });
    const seqAfter = ((await seqRes.json()) as { after: string }).after;

    const batchDir = createProjectDir();
    writeHtml(batchDir, "batch.html", TWO_TWEENS);
    const batchApp = new Hono();
    registerFileRoutes(batchApp, createAdapter(batchDir));
    const batchRes = await batchApp.request(
      "http://localhost/projects/demo/gsap-mutations/batch.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shift-positions-batch",
          shifts: [
            { targetSelector: "#a", delta: 1 },
            { targetSelector: "#b", delta: 0.5 },
          ],
        }),
      },
    );
    const batch = (await batchRes.json()) as { ok: boolean; changed: boolean; after: string };

    expect(batchRes.status).toBe(200);
    expect(batch.ok).toBe(true);
    expect(batch.changed).toBe(true);
    // Batching #a then #b in one write == applying them as two sequential single shifts.
    expect(batch.after).toBe(seqAfter);
  });

  it("reports no GSAP mutation for shift-positions-batch in a file with no GSAP script", async () => {
    // Same contract as its shift-positions / scale-positions siblings: a file with
    // no GSAP block is a no-op {ok, changed:false}, not a 400.
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/index.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift-positions-batch",
        shifts: [{ targetSelector: "#box", delta: 1 }],
      }),
    });
    const result = (await res.json()) as { ok?: boolean; changed?: boolean; mutated?: boolean };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.mutated).toBe(false);
  });

  it("rejects a shift-positions-batch with a missing/non-array `shifts` field (400)", async () => {
    const projectDir = createProjectDir();
    writeHtml(
      projectDir,
      "comp.html",
      `<!DOCTYPE html><html><body><script data-hyperframes-gsap>
const tl = gsap.timeline({ paused: true });
tl.to("#a", { duration: 1, x: 100 }, 1);
</script></body></html>`,
    );
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/gsap-mutations/comp.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shift-positions-batch" }),
    });
    const result = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(result.error).toContain("shifts");
  });
});
