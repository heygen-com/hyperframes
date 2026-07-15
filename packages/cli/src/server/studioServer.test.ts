import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSource } from "./runtimeSource.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";

describe("loadRuntimeSource", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSource()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});

describe("createStudioServer autoProxy plumbing", () => {
  const dirs: string[] = [];
  let server: StudioServer | undefined;

  function tmpProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-studio-server-test-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    server?.watcher.close();
    server = undefined;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("hyperframes.json media.autoProxy=false flows through to the adapter", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir });

    expect(server.adapter.autoProxy).toBe(false);
  });

  it("defaults the adapter to autoProxy=true when neither option nor config disables it", () => {
    server = createStudioServer({ projectDir: tmpProject() });
    expect(server.adapter.autoProxy).toBe(true);
  });

  it("an explicit option (the preview command's resolved --proxy flag) wins over config", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir, autoProxy: true });

    expect(server.adapter.autoProxy).toBe(true);
  });
});
