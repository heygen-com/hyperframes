import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const probed = new URL("./transcribe.ts", import.meta.url).href;
const script = `const { getMediaDurationSeconds } = await import(${JSON.stringify(probed)});
process.stdout.write(String(getMediaDurationSeconds("clip.mp4")));`;

// fails without the fix: the probe wrote straight to this process's stderr.
it.skipIf(process.platform === "win32")(
  "shows control characters in what a failed probe said as text, across the whole stderr stream",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-probe-"));
    const probe = join(dir, "ffprobe");
    writeFileSync(
      probe,
      "#!/bin/sh\nprintf 'clip: od\\033[2Jd\\007\\nsecond line\\n' >&2\nexit 1\n",
    );
    chmodSync(probe, 0o755);
    try {
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          env: { ...process.env, HYPERFRAMES_FFPROBE_PATH: probe },
          encoding: "utf-8",
          timeout: 100_000,
        },
      );
      expect(run.stdout).toBe("null");
      expect(run.stderr).toContain("clip: od\\x1b[2Jd\\x07\nsecond line");
      expect(run.stderr).not.toContain("\u001b");
      expect(run.stderr).not.toContain("\u0007");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  120_000,
);
