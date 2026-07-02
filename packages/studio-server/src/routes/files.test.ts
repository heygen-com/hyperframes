import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const payload = (await response.json()) as {
      changed?: boolean;
      path?: string;
      backupPath?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.changed).toBe(true);
    expect(payload.path).toBe("index.html");
    expect(payload.backupPath).toMatch(/^\.hyperframes\/backup\//);
    expect(readFileSync(join(projectDir, payload.backupPath!), "utf-8")).toBe(
      '<div id="title">Before</div>',
    );
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toContain("After");
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
      after: string;
      parsed: { animations: Array<{ fromProperties?: Record<string, number | string> }> };
    };

    expect(res.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.after).toContain("opacity: 0.2");
    expect(result.parsed.animations[0].fromProperties?.opacity).toBe(0.2);
    // x unchanged
    expect(result.parsed.animations[0].fromProperties?.x).toBe(-50);
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
});
