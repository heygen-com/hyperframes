import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// The Python script is replaced by one that writes these bytes at the name it is handed, as the
// real one does, fails when the text is "fail", or writes nothing when it is "no-file".
// Links need a privilege on Windows, and it has no permission bits or 240-character names to keep.
const WINDOWS = process.platform === "win32";
const AUDIO = "RIFF-audio-bytes";
const scriptRuns: string[] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fs = await import("node:fs");
  const execFileSync = (cmd: string, args: string[]) => {
    if (args[0] === "--version") return "Python 3.11.0";
    if (args[0] === "-c") return "";
    if (cmd === "which" || cmd === "where") return "/usr/bin/python3\n";
    if (args[3] === "quiet-exit")
      throw Object.assign(new Error(`Command failed: python ${args.join(" ")}`), {
        stderr: "",
        status: null,
        signal: "SIGKILL",
      });
    if (args[3] === "no-start")
      throw Object.assign(new Error("spawn E2BIG"), { stderr: undefined });
    scriptRuns.push(args[6]!);
    if (args[3] !== "no-file") fs.writeFileSync(args[6]!, AUDIO);
    if (args[3] === "fail") throw Object.assign(new Error("Command failed"), { stderr: "boom" });
    return JSON.stringify({
      outputPath: args[6],
      sampleRate: 24000,
      durationSeconds: 1,
      langApplied: true,
    });
  };
  return { ...actual, execFileSync };
});

vi.mock("./manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager.js")>();
  return {
    ...actual,
    ensureModel: vi.fn().mockResolvedValue("/fake/model.onnx"),
    ensureVoices: vi.fn().mockResolvedValue("/fake/voices.bin"),
  };
});

const { synthesize } = await import("./synthesize.js");

describe("synthesize: the output file", () => {
  let dir: string;
  let output: string;
  let other: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-tts-output-test-"));
    output = join(dir, "speech.wav");
    other = join(dir, "other.txt");
    writeFileSync(other, "kept");
    scriptRuns.length = 0;
    delete process.env.HYPERFRAMES_PYTHON;
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a new file at the output name and reports that name", async () => {
    const result = await synthesize("hello", output);

    expect(result.outputPath).toBe(output);
    expect(readFileSync(output, "utf8")).toBe(AUDIO);
    expect(readdirSync(dir).sort()).toEqual(["other.txt", "speech.wav"]);
  });

  it("hands the script a fresh name in the same folder with the same ending", async () => {
    await synthesize("hello", output);

    expect(scriptRuns).toHaveLength(1);
    expect(scriptRuns[0]).not.toBe(output);
    expect(dirname(scriptRuns[0]!)).toBe(dir);
    expect(basename(scriptRuns[0]!)).toMatch(/^\.tmp-[0-9a-f-]{36}\.wav$/);
  });

  it.skipIf(WINDOWS)("stages under a short name however long the output name is", async () => {
    const long = join(dir, `${"n".repeat(240)}.wav`);

    await synthesize("hello", long);

    expect(basename(scriptRuns[0]!)).toHaveLength(45);
    expect(readFileSync(long, "utf8")).toBe(AUDIO);
  });

  it.skipIf(WINDOWS)("keeps the permissions of the file it replaces", async () => {
    writeFileSync(output, "old audio");
    chmodSync(output, 0o600);

    await synthesize("hello", output);

    expect(lstatSync(output).mode & 0o777).toBe(0o600);
  });

  it.skipIf(WINDOWS || process.getuid?.() === 0)(
    "refuses a write-protected output before running the script",
    async () => {
      writeFileSync(output, "approved take");
      chmodSync(output, 0o444);

      await expect(synthesize("hello", output)).rejects.toThrow(/EACCES/);

      expect(scriptRuns).toHaveLength(0);
      expect(readFileSync(output, "utf8")).toBe("approved take");
    },
  );

  it("says why and leaves nothing behind when the output name cannot be replaced", async () => {
    mkdirSync(join(output, "inside"), { recursive: true });

    await expect(synthesize("hello", output)).rejects.toThrow(/Speech synthesis failed\nE[A-Z]+/);

    expect(readdirSync(dir).sort()).toEqual(["other.txt", "speech.wav"]);
    expect(lstatSync(output).isDirectory()).toBe(true);
  });

  it("names the exit, not the command line, when the script dies without a word", async () => {
    const failure = await synthesize("quiet-exit", output).catch((error: Error) => error.message);

    expect(failure).toBe("Speech synthesis failed\nThe script was stopped by SIGKILL");
  });

  it.skipIf(WINDOWS)(
    "replaces a link to a write-protected file and leaves that file alone",
    async () => {
      chmodSync(other, 0o444);
      symlinkSync(other, output);

      await synthesize("hello", output);

      expect(lstatSync(output).isSymbolicLink()).toBe(false);
      expect(readFileSync(other, "utf8")).toBe("kept");
    },
  );

  it("says why when the script could not be started", async () => {
    await expect(synthesize("no-start", output)).rejects.toThrow(
      "Speech synthesis failed\nspawn E2BIG",
    );
  });

  it("says why when the script reports success and leaves no file", async () => {
    await expect(synthesize("no-file", output)).rejects.toThrow(
      "Speech synthesis failed\nSynthesis completed but no output file was created",
    );
  });

  it.skipIf(WINDOWS)(
    "replaces a link at the output name and leaves the file it points to alone",
    async () => {
      symlinkSync(other, output);

      await synthesize("hello", output);

      expect(readFileSync(other, "utf8")).toBe("kept");
      expect(lstatSync(output).isSymbolicLink()).toBe(false);
      expect(readFileSync(output, "utf8")).toBe(AUDIO);
    },
  );

  it("replaces an existing file at the output name", async () => {
    writeFileSync(output, "old audio");

    await synthesize("hello", output);

    expect(readFileSync(output, "utf8")).toBe(AUDIO);
  });

  it.skipIf(WINDOWS)(
    "leaves the output name and the folder as they were when the script fails",
    async () => {
      symlinkSync(other, output);

      await expect(synthesize("fail", output)).rejects.toThrow("Speech synthesis failed\nboom");

      expect(lstatSync(output).isSymbolicLink()).toBe(true);
      expect(readFileSync(other, "utf8")).toBe("kept");
      expect(readdirSync(dir).sort()).toEqual(["other.txt", "speech.wav"]);
    },
  );
});
