import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SHERPA_ERROR_PREFIX, SHERPA_RESULT_PREFIX } from "./parakeet.js";

const WORKER = fileURLToPath(new URL("./sherpaWorker.ts", import.meta.url));

// Stand-in sherpa-onnx-node, 3 s of sound: the whole window (300 samples) drops the first 2 s; the
// padded window (350) hears it, and for speech.wav so does the padded gap +-0.5 s (308) alone.
const FAKE_SHERPA = `
let path;
module.exports = {
  readWave(p) {
    path = p;
    if (path.endsWith("broken.wav")) throw new Error("Failed to read " + path);
    if (path.endsWith("lines.wav")) throw new Error("Could not find it. Tried\\n\\n  ../a.node\\n  ./b.node\\n");
    if (path.endsWith("long.wav")) return { sampleRate: 100, samples: new Float32Array(60000) };
    return { sampleRate: 100, samples: new Float32Array(300).fill(0.5) };
  },
  OfflineRecognizer: class {
    constructor() {
      if (process.env.STARTED) require("fs").writeFileSync(process.env.STARTED, "");
    }
    createStream() { return { acceptWaveform(w) { this.w = w; } }; }
    decode() {
      if (path.endsWith("long.wav")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    getResult(stream) {
      const n = stream.w.samples.length;
      if (n === 300) return { tokens: [" not"], timestamps: [2.08], durations: [0.4] };
      if (n === 350) return { tokens: [" ask", " not"], timestamps: [0.75, 1.5], durations: [0.4, 0.4] };
      return n === 308 && path.endsWith("speech.wav")
        ? { tokens: [" ask", " not"], timestamps: [1, 2.58], durations: [0.4, 0.4] }
        : { tokens: [], timestamps: [], durations: [] };
    }
  },
};
`;

function runWorker(runtimeDir: string, wavPath: string) {
  const input = JSON.stringify({ wavPath, runtimeDir, config: {} });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", WORKER],
      { env: { ...process.env, HYPERFRAMES_PARAKEET_INPUT: input } },
      (err, stdout, stderr) => resolve({ code: err ? (err.code as number) : 0, stdout, stderr }),
    );
  });
}

describe("sherpaWorker", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function fakeRuntime(): string {
    root = mkdtempSync(join(tmpdir(), "hf-sherpa-worker-"));
    const pkg = join(root, "node_modules", "sherpa-onnx-node");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{"name":"sherpa-onnx-node","main":"index.js"}');
    writeFileSync(join(pkg, "index.js"), FAKE_SHERPA);
    return root;
  }

  function windowsOf(stdout: string) {
    const line = stdout.split("\n").find((l) => l.startsWith(SHERPA_RESULT_PREFIX))!;
    return JSON.parse(line.slice(SHERPA_RESULT_PREFIX.length));
  }

  it("decodes a gap that skipped loud audio on its own and splices in its new tokens", async () => {
    const { code, stdout } = await runWorker(fakeRuntime(), "speech.wav");
    expect(code).toBe(0);
    expect(windowsOf(stdout)).toEqual([
      { offset: 0, tokens: [" ask", " not"], timestamps: [0.5, 2.08], durations: [0.4, 0.4] },
    ]);
  });

  it("re-decodes the window with leading silence when the gap alone gives nothing", async () => {
    const { code, stdout } = await runWorker(fakeRuntime(), "hum.wav");
    expect(code).toBe(0);
    expect(windowsOf(stdout)).toEqual([
      { offset: 0, tokens: [" ask", " not"], timestamps: [0.25, 1], durations: [0.4, 0.4] },
    ]);
  });

  it("exits non-zero with one prefixed error line when it cannot read the audio", async () => {
    const { code, stderr } = await runWorker(fakeRuntime(), "broken.wav");
    expect(code).toBe(1);
    expect(stderr).toContain(`${SHERPA_ERROR_PREFIX}Failed to read broken.wav`);
  });

  it("keeps every line of a multi-line error on its one prefixed line", async () => {
    const { code, stderr } = await runWorker(fakeRuntime(), "lines.wav");
    expect(code).toBe(1);
    expect(stderr).toContain(`${SHERPA_ERROR_PREFIX}Could not find it. Tried ../a.node ./b.node\n`);
  });

  it.skipIf(process.platform === "win32")(
    "stops between windows once the CLI that spawned it is gone",
    async () => {
      const started = join(fakeRuntime(), "started");
      const input = JSON.stringify({ wavPath: "long.wav", runtimeDir: root, config: {} });
      // The shell waits for the first window, then exits, orphaning a 10-window decode.
      const shell =
        `"${process.execPath}" --import tsx "${WORKER}" >/dev/null 2>&1 & echo $!; ` +
        `while [ ! -e "${started}" ]; do sleep 0.1; done`;
      const pid = await new Promise<number>((resolve) =>
        execFile(
          "sh",
          ["-c", shell],
          { env: { ...process.env, HYPERFRAMES_PARAKEET_INPUT: input, STARTED: started } },
          (_e, out) => resolve(Number(out.trim())),
        ),
      );
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      const deadline = Date.now() + 4000;
      while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      const orphanSurvived = alive();
      if (orphanSurvived) process.kill(pid, "SIGKILL");
      expect(orphanSurvived).toBe(false);
    },
    15_000,
  );

  it("names the missing runtime when sherpa-onnx-node is not installed", async () => {
    root = mkdtempSync(join(tmpdir(), "hf-sherpa-worker-"));
    const { code, stderr } = await runWorker(root, "speech.wav");
    expect(code).toBe(1);
    expect(stderr).toContain(`${SHERPA_ERROR_PREFIX}sherpa-onnx-node is not installed in ${root}`);
  });
});
