import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerVstRoutes } from "./vst";

function makeApi(adapter: Record<string, unknown>): Hono {
  const api = new Hono();
  registerVstRoutes(api, adapter as never);
  return api;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-vst-test-"));
  tempDirs.push(projectDir);
  return projectDir;
}

afterEach(() => {
  delete process.env.HF_VST_HOST_CMD;
});

/** Points HF_VST_HOST_CMD at a fake sidecar shell script for the duration of a test. */
function installFakeVstHost(projectDir: string, scriptBody: string): void {
  const script = join(projectDir, "fake-vst.sh");
  writeFileSync(script, scriptBody);
  chmodSync(script, 0o755);
  process.env.HF_VST_HOST_CMD = script;
}

function postCarve(api: Hono, body: Record<string, unknown>): Promise<Response> {
  return api.request("/vst/carve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("vst routes", () => {
  it("POST /vst/start returns the sidecar port and token", async () => {
    const api = makeApi({
      startVstSidecar: () => Promise.resolve({ port: 9555, token: "secret-token" }),
      getVstSidecarStatus: () => ({ running: true, port: 9555 }),
    });
    const res = await api.request("/vst/start", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ port: 9555, token: "secret-token" });
  });

  it("POST /vst/start returns 503 with install hint when unsupported", async () => {
    const api = makeApi({});
    const res = await api.request("/vst/start", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.installHint).toContain("uv tool install");
  });

  it("GET /vst/status reflects adapter state", async () => {
    const api = makeApi({ getVstSidecarStatus: () => ({ running: false, port: null }) });
    const res = await api.request("/vst/status");
    expect(await res.json()).toEqual({ running: false, port: null });
  });

  it("POST /vst/carve returns bands from the sidecar", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "media"), { recursive: true });
    writeFileSync(join(projectDir, "media/music.wav"), "RIFF");
    writeFileSync(join(projectDir, "media/vo.wav"), "RIFF");
    // Fake sidecar: print a fixed bands payload for `carve`.
    installFakeVstHost(
      projectDir,
      `#!/bin/sh\necho '{"bands":[{"freq":1000,"gainDb":-4,"q":1.5},{"freq":2500,"gainDb":-2,"q":1.5}]}'\n`,
    );

    const api = makeApi({
      resolveProject: () => Promise.resolve({ dir: projectDir }),
    });
    const res = await postCarve(api, {
      projectId: "p1",
      musicPath: "media/music.wav",
      voicePath: "media/vo.wav",
      maxCutDb: 4,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bands).toHaveLength(2);
    expect(body.bands[0]).toEqual({ freq: 1000, gainDb: -4, q: 1.5 });
  });

  it("POST /vst/carve 404s when a track file is missing", async () => {
    const projectDir = createProjectDir();
    const api = makeApi({ resolveProject: () => Promise.resolve({ dir: projectDir }) });
    const res = await postCarve(api, {
      projectId: "p1",
      musicPath: "media/nope.wav",
      voicePath: "media/nope.wav",
      maxCutDb: 4,
    });
    expect(res.status).toBe(404);
  });

  it("POST /vst/carve 500s when the sidecar fails", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "media"), { recursive: true });
    writeFileSync(join(projectDir, "media/vo.wav"), "RIFF");
    installFakeVstHost(projectDir, `#!/bin/sh\necho "boom" >&2; exit 1\n`);
    const api = makeApi({ resolveProject: () => Promise.resolve({ dir: projectDir }) });
    const res = await postCarve(api, {
      projectId: "p1",
      musicPath: "media/vo.wav",
      voicePath: "media/vo.wav",
      maxCutDb: 4,
    });
    expect(res.status).toBe(500);
  });
});
