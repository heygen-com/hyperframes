import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFfmpegVersion } from "./shared.js";

describe.skipIf(process.platform === "win32")("readFfmpegVersion", () => {
  const configured = process.env.HYPERFRAMES_FFMPEG_PATH;
  let dir: string;
  afterEach(() => {
    if (configured === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = configured;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the ffmpeg that HYPERFRAMES_FFMPEG_PATH names", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-ffmpeg-version-"));
    const fake = join(dir, "ffmpeg");
    writeFileSync(fake, "#!/bin/sh\necho 'ffmpeg version 9.9-fake'\n");
    chmodSync(fake, 0o755);
    process.env.HYPERFRAMES_FFMPEG_PATH = fake;

    expect(await readFfmpegVersion()).toBe("ffmpeg version 9.9-fake");
  });

  it("names the configured binary and the setting when it is missing", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-ffmpeg-version-"));
    process.env.HYPERFRAMES_FFMPEG_PATH = join(dir, "no-ffmpeg-here");

    const failure = readFfmpegVersion();
    await expect(failure).rejects.toThrow(/no-ffmpeg-here.*HYPERFRAMES_FFMPEG_PATH/);
    await expect(failure).rejects.toHaveProperty("code", "ENOENT");
  });
});
