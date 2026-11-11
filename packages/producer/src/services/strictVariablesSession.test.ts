import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeCaptureSession, createCaptureSession, initializeSession } from "@hyperframes/engine";
import type { CaptureOptions } from "@hyperframes/engine";
import { createFileServer } from "./fileServer.js";
import { compileForRender } from "./htmlCompiler.js";
import { writeCompiledArtifacts } from "./render/shared.js";

// Real Chromium on the render path: the compiled page carries the runtime, and the session's own
// readiness poll runs before the variables are checked against what the page declares.
const DECLARED = JSON.stringify([
  { id: "title", type: "string", label: "Title", default: "Hi" },
  { id: "speed", type: "number", label: "Speed", default: 1 },
]);
const page = (htmlAttributes: string) => `<!doctype html>
<html ${htmlAttributes}><body style="margin:0">
  <div data-composition-id="main" data-start="0" data-duration="1" data-width="160" data-height="120" data-no-timeline></div>
</body></html>`;

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hf-strict-variables-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function openSession(html: string, options: Partial<CaptureOptions>) {
  const projectDir = mkdtempSync(join(root, "case-"));
  const workDir = mkdtempSync(join(root, "work-"));
  writeFileSync(join(projectDir, "index.html"), html);
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
    {
      width: 160,
      height: 120,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      quality: 80,
      ...options,
    },
    null,
    { browserGpuMode: "software", playerReadyTimeout: 10_000 },
  );
  return {
    session,
    close: async () => {
      await closeCaptureSession(session).catch(() => {});
      server.close();
    },
  };
}

async function initialize(options: Partial<CaptureOptions>) {
  const { session, close } = await openSession(
    page(`data-composition-variables='${DECLARED}'`),
    options,
  );
  try {
    await initializeSession(session);
    return session.strictVariablesChecked;
  } finally {
    await close();
  }
}

describe("strictVariables on a capture session", () => {
  it("lets a session start when the page declares the variables, and says it checked", async () => {
    expect(
      await initialize({ variables: { title: "Hello", speed: 2 }, strictVariables: true }),
    ).toBe(true);
  }, 60_000);

  it("refuses a variable the page does not declare, naming it, before any frame", async () => {
    await expect(
      initialize({ variables: { titel: "Hello" }, strictVariables: true }),
    ).rejects.toMatchObject({
      code: "VARIABLES_INVALID",
      owner: "user",
      retryable: false,
      message: 'Variable "titel" is not declared in data-composition-variables.',
    });
  }, 60_000);

  it("refuses a value of the wrong type without echoing it", async () => {
    const result = initialize({ variables: { speed: "fast-secret" }, strictVariables: true });
    await expect(result).rejects.toMatchObject({
      code: "VARIABLES_INVALID",
      publicMetadata: {
        issues: [
          { kind: "type-mismatch", variableId: "speed", expected: "number", actual: "string" },
        ],
      },
    });
    await expect(result).rejects.not.toThrow(/fast-secret/);
  }, 60_000);

  it("refuses when the page's declarations cannot be read, not as undeclared", async () => {
    const { session, close } = await openSession(page(`data-composition-variables='{broken'`), {
      variables: { title: "Hello" },
      strictVariables: true,
    });
    try {
      await expect(initializeSession(session)).rejects.toMatchObject({
        code: "VARIABLES_INVALID",
        publicMetadata: { issues: [{ kind: "declarations-unreadable" }] },
      });
    } finally {
      await close();
    }
  }, 60_000);

  it("checks nothing and still says it checked when there are no variables", async () => {
    expect(await initialize({ strictVariables: true })).toBe(true);
  }, 60_000);

  it("does not check, and does not say it did, when strict variables were not asked", async () => {
    expect(await initialize({ variables: { titel: "Hello" } })).toBeUndefined();
  }, 60_000);
});
