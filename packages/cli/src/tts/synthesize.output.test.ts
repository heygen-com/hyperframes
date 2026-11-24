import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lstatSync,
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
// real one does, or fails when the text is "fail".
const AUDIO = "RIFF-audio-bytes";
const scriptRuns: string[] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const fs = await import("node:fs");
  const execFileSync = (cmd: string, args: string[]) => {
    if (args[0] === "--version") return "Python 3.11.0";
    if (args[0] === "-c") return "";
    if (cmd === "which" || cmd === "where") return "/usr/bin/python3\n";
    scriptRuns.push(args[6]!);
    fs.writeFileSync(args[6]!, AUDIO);
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
    expect(basename(scriptRuns[0]!)).toMatch(/^\.tmp-[0-9a-f-]{36}-speech\.wav$/);
  });

  it("replaces a link at the output name and leaves the file it points to alone", async () => {
    symlinkSync(other, output);

    await synthesize("hello", output);

    expect(readFileSync(other, "utf8")).toBe("kept");
    expect(lstatSync(output).isSymbolicLink()).toBe(false);
    expect(readFileSync(output, "utf8")).toBe(AUDIO);
  });

  it("replaces an existing file at the output name", async () => {
    writeFileSync(output, "old audio");

    await synthesize("hello", output);

    expect(readFileSync(output, "utf8")).toBe(AUDIO);
  });

  it("leaves the output name and the folder as they were when the script fails", async () => {
    symlinkSync(other, output);

    await expect(synthesize("fail", output)).rejects.toThrow("Speech synthesis failed\nboom");

    expect(lstatSync(output).isSymbolicLink()).toBe(true);
    expect(readFileSync(other, "utf8")).toBe("kept");
    expect(readdirSync(dir).sort()).toEqual(["other.txt", "speech.wav"]);
  });
});
