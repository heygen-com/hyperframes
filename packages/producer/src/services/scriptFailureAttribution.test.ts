import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureFrameToBuffer,
  closeCaptureSession,
  createCaptureSession,
  initializeSession,
  VfxFailureError,
} from "@hyperframes/engine";
import { createFileServer } from "./fileServer.js";
import { compileForRender } from "./htmlCompiler.js";
import { writeCompiledArtifacts } from "./render/shared.js";

// Real Chromium on the render path (compiled, CDN scripts inlined, body scripts re-run after fonts).
// The timeline never registers in any case; what differs is whose script threw.
const composition = (scripts: string) => `<!doctype html>
<html><body style="margin:0">
  <div data-composition-id="main" data-start="0" data-duration="1" data-width="160" data-height="120"></div>
  ${scripts}
</body></html>`;

const handler =
  "document.body.insertAdjacentHTML('beforeend', '<img src=\"data:,\" onerror=\"null.timeline\">');";
const decode = "var image = new Image(); image.src = 'data:image/png;base64,AAAA'; image.decode();";
const widgetScripts: Record<string, string> = {
  "/sync.js": "throw new Error('widget failed at load');",
  "/widget.js": "setTimeout(function widget() { throw new Error('widget failed'); }, 0);",
  "/decode.js": decode,
  "/hash-decode.js": `location.hash = 'consent'; ${decode}`,
  "/eval.js": "eval('null.timeline');",
  "/eval-later.js": "eval('setTimeout(function () { null.timeline; }, 0)');",
  "/insert-later.js":
    "var s = document.createElement('script'); s.text = 'setTimeout(function () { null.timeline; }, 0)'; document.body.appendChild(s);",
  "/string-timer.js": "setTimeout('null.timeline', 0);",
  "/inline-handler.js": handler,
  "/moved-inline-handler.js": `history.replaceState(null, '', '/elsewhere/page'); ${handler}`,
};

let root: string;
let widgetServer: Server;
let widgetOrigin: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "hf-script-attribution-"));
  widgetServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(widgetScripts[request.url ?? ""] ?? "");
  });
  await new Promise<void>((resolve) => widgetServer.listen(0, "127.0.0.1", resolve));
  const address = widgetServer.address();
  if (!address || typeof address === "string") throw new Error("widget server has no port");
  widgetOrigin = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  widgetServer?.close();
  rmSync(root, { recursive: true, force: true });
});

interface SessionErrors {
  codes: string[];
  scriptLoadFailures: string[];
  pageErrors: string[];
  vfxFailure?: string;
}

async function timelineWarningCodes(files: Record<string, string>): Promise<string[]> {
  return (await sessionErrors(files)).codes;
}

// Console errors can land after the session is ready, so a case that expects one waits for it.
// VFX layers first paint when a frame is captured, so a VFX case captures `frames` first.
async function sessionErrors(
  files: Record<string, string>,
  expectedPageError?: string,
  frames = 0,
): Promise<SessionErrors> {
  const projectDir = mkdtempSync(join(root, "case-"));
  const workDir = mkdtempSync(join(root, "work-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(projectDir, name), body);
  const compiled = await compileForRender(
    projectDir,
    join(projectDir, "index.html"),
    join(workDir, "downloads"),
  );
  writeCompiledArtifacts(compiled, workDir, false);
  const server = await createFileServer({
    projectDir,
    compiledDir: join(workDir, "compiled"),
    port: 0,
  });
  const session = await createCaptureSession(
    server.url,
    join(workDir, "frames"),
    { width: 160, height: 120, fps: { num: 30, den: 1 }, format: "jpeg", quality: 80 },
    null,
    // Past the 2 s script-load grace, so a missing script still takes the fail-fast path.
    { browserGpuMode: "software", playerReadyTimeout: 4_000 },
  );
  try {
    await initializeSession(session);
    for (let frame = 0; frame < frames; frame++)
      await captureFrameToBuffer(session, frame, frame / 30);
    if (expectedPageError) {
      await vi.waitFor(() => expect(session.pageErrors.join("\n")).toContain(expectedPageError), {
        timeout: 10_000,
        interval: 50,
      });
    }
    return {
      codes: session.warnings
        .map((warning) => warning.code)
        .filter((code) => code.startsWith("sub_")),
      scriptLoadFailures: session.scriptLoadFailures,
      pageErrors: session.pageErrors,
      vfxFailure: session.vfxFailure,
    };
  } finally {
    await closeCaptureSession(session).catch(() => {});
    server.close();
  }
}

// A CSS-only page (nothing waits on a timeline) whose one layer runs a VFX chain.
const vfxComposition = (chain: string, innerStyle = "") => `<!doctype html>
<html><head><style>
  #host, #host > canvas, .hf-vfx-in { position: absolute; left: 0; top: 0; width: 160px; height: 120px; }
</style></head><body style="margin:0">
  <div data-composition-id="main" data-start="0" data-duration="1" data-width="160" data-height="120" data-no-timeline>
    <div id="host" class="clip" data-start="0" data-duration="1" data-vfx-chain='${chain}'>
      <canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in" style="${innerStyle}"><div style="width:80px;height:120px;background:red"></div></div></canvas>
      <canvas class="hf-vfx-out"></canvas>
    </div>
  </div>
</body></html>`;
const vfxNode = (type: string, params: Record<string, number>) =>
  JSON.stringify({ version: 1, nodes: [{ type, id: "n1", params }] });

// Measured: with a failed chain the layer is not drawn at all, so every frame is wrong.
describe("a failed VFX chain", () => {
  it("fails the render at once, whether or not anything waits on a timeline", async () => {
    const files = { "index.html": vfxComposition(vfxNode("no-such-effect", {})) };
    await expect(timelineWarningCodes(files)).rejects.toBeInstanceOf(VfxFailureError);
  }, 30_000);

  const warp = { waveType: 1, direction: 0, speed: 0, pinning: 1, phase: 0, height: 30, width: 60 };

  it("leaves a working chain alone", async () => {
    const files = { "index.html": vfxComposition(vfxNode("wave-warp", warp)) };
    expect(await timelineWarningCodes(files)).toEqual([]);
  }, 30_000);

  // A layer animated in from zero width is empty on its first frame, which is correct; later frames paint.
  it("keeps one frame's empty capture a page error, not a stop", async () => {
    const files = { "index.html": vfxComposition(vfxNode("wave-warp", warp), "width:0") };
    const errors = await sessionErrors(files, "vfx-frame:", 2);
    expect(errors.codes).toEqual([]);
    expect(errors.vfxFailure).toBeUndefined();
    expect(errors.pageErrors).toEqual([expect.stringContaining("vfx-frame:")]);
  }, 30_000);
});

describe("which uncaught errors fail a timeline that never registers", () => {
  it.each([
    [
      "an inline script in the composition throws",
      { "index.html": composition("<script>null.timeline;</script>") },
    ],
    [
      "an inline script in the composition throws after an await",
      {
        "index.html": composition(
          "<script>(async function () { await new Promise(function (r) { setTimeout(r, 50); }); null.timeline; })();</script>",
        ),
      },
    ],
    [
      "the composition evals its own throw",
      { "index.html": composition(`<script>eval("null.timeline");</script>`) },
    ],
    [
      "an inline script in the composition's head throws",
      {
        "index.html": composition("").replace(
          "<html>",
          "<html><head><script>null.timeline;</script></head>",
        ),
      },
    ],
    [
      "a sub-composition's inline script throws",
      {
        "index.html": composition("").replace(
          "></div>",
          '><div data-composition-id="scene" data-composition-src="scene.html" data-start="0" data-duration="1"></div></div>',
        ),
        "scene.html":
          '<template><div data-composition-id="scene" data-width="160" data-height="120"><script>null.timeline;</script></div></template>',
      },
    ],
    [
      "a script file from the project throws",
      {
        "index.html": composition('<script src="comp.js"></script>'),
        "comp.js": "function build() { var tl = null; tl.timeline(); }\nbuild();",
      },
    ],
    [
      "a script file from the project does not parse",
      { "index.html": composition('<script src="comp.js"></script>'), "comp.js": "var x = {;" },
    ],
    [
      "a script from the project is missing",
      { "index.html": composition('<script src="missing.js"></script>') },
    ],
  ])(
    "fails when %s",
    async (_case, files) => {
      expect(await timelineWarningCodes(files)).toEqual(["sub_timeline_script_failure"]);
    },
    30_000,
  );

  // A load failure cuts the timeline wait short; a scene that threw may still register, so it must not.
  it("keeps a scene's throw after it registered as a page error, never a load failure", async () => {
    const register = (id: string) => `(window.__timelines = window.__timelines || {}).${id} = {};`;
    const files = {
      "index.html": composition(`<script>${register("main")}</script>`).replace(
        "></div>",
        '><div data-composition-id="scene" data-composition-src="scene.html" data-start="0" data-duration="1"></div></div>',
      ),
      "scene.html": `<template><div data-composition-id="scene" data-width="160" data-height="120"><script>${register("scene")} null.optionalBadge;</script></div></template>`,
    };
    const errors = await sessionErrors(files, "optionalBadge");
    expect(errors.codes).toEqual([]);
    expect(errors.scriptLoadFailures).toEqual([]);
    expect(errors.pageErrors).toEqual([expect.stringContaining("optionalBadge")]);
  }, 30_000);

  it.each(Object.keys(widgetScripts))(
    "keeps the error a readiness warning when the cross-origin script %s throws or rejects",
    async (script) => {
      const files = {
        "index.html": composition(`<script src="${widgetOrigin}${script}"></script>`),
      };
      expect(await timelineWarningCodes(files)).toEqual(["sub_timeline_readiness_timeout"]);
    },
    30_000,
  );
});
