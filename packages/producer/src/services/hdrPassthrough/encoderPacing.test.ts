import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import {
  assertPaceableEncoder,
  EncoderPacingError,
  encoderProcessProblem,
  procThreadStates,
  readEncoderProcess,
  waitUntilIdle,
} from "./encoderPacing.js";

function scripted(sequence: Array<readonly string[] | null>) {
  let at = 0;
  return () => sequence[Math.min(at++, sequence.length - 1)] ?? null;
}

const fast = { pollMs: 0, calmPolls: 3, timeoutMs: 1_000, sleep: async () => {} };

describe("waitUntilIdle", () => {
  it("waits for several idle polls in a row", async () => {
    const states = [["R", "S"], ["S", "S"], ["S", "R"], ["S"], ["S", "S"], ["S", "S"], ["R"]];
    let polls = 0;
    const read = scripted(states);
    await waitUntilIdle(() => {
      polls++;
      return read();
    }, fast);
    // Busy, idle, busy (resets), then three idle polls.
    expect(polls).toBe(6);
  });

  it("counts uninterruptible waits as busy", async () => {
    let polls = 0;
    const read = scripted([["D"], ["S"], ["S"], ["S"]]);
    await waitUntilIdle(() => {
      polls++;
      return read();
    }, fast);
    expect(polls).toBe(4);
  });

  it("fails when the thread states cannot be read, instead of calling the encoder idle", async () => {
    await expect(waitUntilIdle(scripted([["R"], []]), fast)).rejects.toBeInstanceOf(
      EncoderPacingError,
    );
    await expect(waitUntilIdle(scripted([[]]), fast)).rejects.toThrow(
      "the encoder's thread states cannot be read",
    );
  });

  it("fails, as an error and not a decline, once the encoder has exited", async () => {
    const exited = await waitUntilIdle(scripted([["R"], null]), fast).catch((error) => error);
    expect(exited).toBeInstanceOf(Error);
    expect(exited).not.toBeInstanceOf(EncoderPacingError);
    expect(String(exited.message)).toContain("the encoder exited mid-encode");
  });

  it("gives up after the timeout", async () => {
    let clock = 0;
    await expect(
      waitUntilIdle(() => ["R"], { ...fast, timeoutMs: 10, now: () => (clock += 4) }),
    ).rejects.toThrow("did not go idle within 10 ms");
  });

  it("stops on abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    await expect(
      waitUntilIdle(() => ["S"], { ...fast, signal: controller.signal }),
    ).rejects.toThrow("stopped");
  });
});

describe.skipIf(process.platform !== "linux")("procThreadStates", () => {
  it("reads a state letter for every thread of a live process", () => {
    const states = procThreadStates(process.pid);
    expect(states?.length).toBeGreaterThan(0);
    for (const state of states ?? []) expect(state).toMatch(/^[A-Za-z]$/);
  });

  it("is null for a process that does not exist", () => {
    expect(procThreadStates(2 ** 22 + 7)).toBeNull();
  });
});

describe("encoderProcessProblem", () => {
  const ffmpeg = { comm: "ffmpeg", exe: "/opt/ffmpeg/bin/ffmpeg", children: 0 };

  it("accepts an ffmpeg with no process of its own", () => {
    expect(encoderProcessProblem(ffmpeg)).toBeNull();
    expect(
      encoderProcessProblem({ ...ffmpeg, exe: "/opt/ffmpeg/bin/ffmpeg (deleted)" }),
    ).toBeNull();
  });

  it.each([
    [
      "a wrapper script",
      { ...ffmpeg, comm: "ffmpeg-wrap.sh", exe: "/usr/bin/bash" },
      "is ffmpeg-wrap.sh",
    ],
    ["a script named ffmpeg", { ...ffmpeg, exe: "/usr/bin/dash" }, "runs /usr/bin/dash"],
    ["a wrapper that forked", { ...ffmpeg, children: 1 }, "started 1 process(es)"],
    ["an unreadable process", { ...ffmpeg, exe: null }, "cannot be read"],
    ["unreadable children", { ...ffmpeg, children: null }, "cannot be read"],
  ])("declines %s", (_name, facts, detail) => {
    expect(encoderProcessProblem(facts)).toContain(detail);
  });

  it("rejects with EncoderPacingError for a missing pid or a refused process", async () => {
    await expect(assertPaceableEncoder(undefined)).rejects.toBeInstanceOf(EncoderPacingError);
    const self = { comm: "node", exe: "/usr/bin/node", children: 0 };
    const reading = (facts: typeof ffmpeg) => (pid: number) => (pid === process.pid ? self : facts);
    await expect(
      assertPaceableEncoder(1, reading({ ...ffmpeg, children: 2 }), async () => {}),
    ).rejects.toThrow("started 2 process(es)");
    await expect(
      assertPaceableEncoder(1, reading(ffmpeg), async () => {}),
    ).resolves.toBeUndefined();
  });

  it("reads a just-spawned encoder again while it still runs this process's executable", async () => {
    const self = { comm: "node", exe: "/usr/bin/node", children: 0 };
    let reads = 0;
    // The fork has not run ffmpeg yet for two reads, then has.
    const read = (pid: number) =>
      pid === process.pid ? self : ++reads <= 2 ? { ...self, comm: "node" } : ffmpeg;
    await expect(assertPaceableEncoder(7, read, async () => {})).resolves.toBeUndefined();
    expect(reads).toBe(3);
    // One that never does declines, as this process's name.
    await expect(
      assertPaceableEncoder(
        7,
        (pid) => (pid === process.pid ? self : self),
        async () => {},
      ),
    ).rejects.toThrow("the encoder process is node, not ffmpeg");
  });
});

describe.skipIf(process.platform !== "linux")("readEncoderProcess", () => {
  it("reads a live process's name, executable and children", async () => {
    // A shell that forks: the shape of an ffmpeg path that is a wrapper around ffmpeg.
    const shell = spawn("sh", ["-c", "sleep 5 & wait"], { stdio: "ignore" });
    try {
      await new Promise((done) => setTimeout(done, 200));
      const facts = readEncoderProcess(shell.pid ?? -1);
      expect(facts.comm).toBe("sh");
      expect(facts.exe).toBeTruthy();
      expect(facts.children).toBe(1);
      expect(encoderProcessProblem(facts)).toBe("the encoder process is sh, not ffmpeg");
    } finally {
      shell.kill("SIGKILL");
    }
  });

  it("cannot read a process that does not exist", () => {
    expect(encoderProcessProblem(readEncoderProcess(2 ** 22 + 7))).toContain("cannot be read");
  });
});
