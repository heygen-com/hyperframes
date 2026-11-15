import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The project folder is the working directory and the first PATH entry, as when a render runs from it.
describe.skipIf(process.platform === "win32")("helper programs the renderer starts", () => {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH;
  let project: string;
  let ran: string;

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "hf-helpers-")));
    ran = join(project, "ran");
    for (const name of ["nvidia-smi", "vm_stat", "ps"]) {
      const file = join(project, name);
      writeFileSync(file, `#!/bin/sh\necho ${name} >> "${ran}"\necho 4096\n`);
      chmodSync(file, 0o755);
    }
    process.chdir(project);
    process.env.PATH = `${project}${delimiter}${originalPath}`;
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    vi.doUnmock("os");
    rmSync(project, { recursive: true, force: true });
  });

  it("never runs an nvidia-smi from the project folder", async () => {
    const { buildChromeArgs } = await import("./browserManager.js");
    buildChromeArgs({ width: 1920, height: 1080 });
    expect(existsSync(ran)).toBe(false);
  });

  it("never runs a vm_stat from the project folder", async () => {
    vi.doMock("os", async (importOriginal) => {
      const os = await importOriginal<typeof import("os")>();
      return { ...os, default: os, platform: () => "darwin" };
    });
    const { getAvailableMemoryMb } = await import("./systemMemory.js");
    getAvailableMemoryMb();
    expect(existsSync(ran)).toBe(false);
  });

  it("never runs a ps from the project folder", async () => {
    const { sampleProcessRss } = await import("../utils/processRss.js");
    await sampleProcessRss([process.pid], undefined, "darwin");
    expect(existsSync(ran)).toBe(false);
  });
});
