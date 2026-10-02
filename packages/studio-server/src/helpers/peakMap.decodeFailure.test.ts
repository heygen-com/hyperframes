import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Stand-in binaries: ffprobe reports a stereo stream, ffmpeg writes samples and then fails.
const fakeBin = vi.hoisted(() => ({ dir: "" }));
vi.mock("@hyperframes/parsers/ff-binaries", () => ({
  findFfBinary: (name: string) => join(fakeBin.dir, name),
}));

import { decodePeakMap } from "./peakMap";

describe("decodePeakMap, decode failure", () => {
  it.skipIf(process.platform === "win32")(
    "rejects partial output when ffmpeg exits nonzero",
    async () => {
      fakeBin.dir = mkdtempSync(join(tmpdir(), "hf-fake-ff-"));
      const script = (name: string, body: string) => {
        const file = join(fakeBin.dir, name);
        writeFileSync(file, `#!/bin/sh\n${body}\n`);
        chmodSync(file, 0o755);
      };
      script("ffprobe", "echo 2");
      script("ffmpeg", "head -c 38400 /dev/zero; exit 1");
      await expect(decodePeakMap("truncated.mov")).rejects.toThrow(/exit 1/);
    },
  );
});
