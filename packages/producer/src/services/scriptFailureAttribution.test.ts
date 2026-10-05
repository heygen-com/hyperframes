import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeCaptureSession, createCaptureSession, initializeSession } from "@hyperframes/engine";
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

const decode = "var image = new Image(); image.src = 'data:image/png;base64,AAAA'; image.decode();";
const widgetScripts: Record<string, string> = {
  "/sync.js": "throw new Error('widget failed at load');",
  "/widget.js": "setTimeout(function widget() { throw new Error('widget failed'); }, 0);",
  "/decode.js": decode,
  "/hash-decode.js": `location.hash = 'consent'; ${decode}`,
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

async function timelineWarningCodes(files: Record<string, string>): Promise<string[]> {
  const projectDir = mkdtempSync(join(root, "case-"));
  const workDir = mkdtempSync(join(root, "work-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(projectDir, name), body);
  const compiled = await compileForRender(
    projectDir,
    join(projectDir, "index.html"),
    join(workDir, "downloads"),
  );
  writeCompiledArtifacts(compiled, workDir, false);
  const compiledDir = join(workDir, "compiled");
  const server = await createFileServer({ projectDir, compiledDir, port: 0 });
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
    return session.warnings
      .map((warning) => warning.code)
      .filter((code) => code.startsWith("sub_"));
  } finally {
    await closeCaptureSession(session).catch(() => {});
    server.close();
  }
}

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
