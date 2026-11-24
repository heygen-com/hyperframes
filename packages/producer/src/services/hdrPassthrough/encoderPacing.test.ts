import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EncoderPacingError,
  type EncoderProcessFacts,
  type EncoderWatchDeps,
  encoderProcessProblem,
  type ExecutableFacts,
  executableProblem,
  LIBX265_BANNER,
  libx265Problem,
  procThreadStates,
  readEncoderProcess,
  scanExecutable,
  type ThreadState,
  waitUntilIdle,
  watchEncoder,
} from "./encoderPacing.js";

/** Threads of the given states, numbered from 1. */
const threadsOf = (states: readonly string[], names: readonly string[] = []): ThreadState[] =>
  states.map((state, i) => ({ tid: i + 1, name: names[i] ?? "ffmpeg", state }));

function scripted(sequence: Array<readonly string[] | null>) {
  let at = 0;
  return () => {
    const states = sequence[Math.min(at++, sequence.length - 1)];
    return states ? threadsOf(states) : null;
  };
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

  it("counts only the polls `settled` accepts", async () => {
    let polls = 0;
    const read = scripted([["S"], ["S"], ["S"], ["S", "S"], ["S", "S"], ["S", "S"]]);
    await waitUntilIdle(
      () => {
        polls++;
        return read();
      },
      fast,
      (threads) => threads.length > 1,
    );
    expect(polls).toBe(6);
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
      waitUntilIdle(() => threadsOf(["R"]), { ...fast, timeoutMs: 10, now: () => (clock += 4) }),
    ).rejects.toThrow("did not go idle within 10 ms");
  });

  it("stops on abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    await expect(
      waitUntilIdle(() => threadsOf(["S"]), { ...fast, signal: controller.signal }),
    ).rejects.toThrow("stopped");
  });
});

describe.skipIf(process.platform !== "linux")("procThreadStates", () => {
  it("reads a name and a state letter for every thread of a live process", () => {
    const threads = procThreadStates(process.pid);
    expect(threads?.length).toBeGreaterThan(0);
    expect(threads?.some((thread) => thread.tid === process.pid)).toBe(true);
    for (const thread of threads ?? []) {
      expect(thread.state).toMatch(/^[A-Za-z]$/);
      expect(thread.name.length).toBeGreaterThan(0);
    }
  });

  it("is null for a process that does not exist", () => {
    expect(procThreadStates(2 ** 22 + 7)).toBeNull();
  });
});

const SELF = { pid: 100, pgrp: 90, session: 80 };
const FFMPEG: EncoderProcessFacts = {
  exe: "/opt/ffmpeg/bin/ffmpeg",
  exeId: "1:2",
  lineage: { ppid: 100, pgrp: 90, session: 80 },
  descendants: 0,
};

describe("encoderProcessProblem", () => {
  it("accepts this process's child, in its group and session, with no process of its own", () => {
    expect(encoderProcessProblem(FFMPEG, SELF)).toBeNull();
  });

  it.each([
    ["a process that forked", { ...FFMPEG, descendants: 1 }, "started 1 process(es)"],
    [
      "a process that made itself a session leader",
      { ...FFMPEG, lineage: { ppid: 100, pgrp: 5, session: 5 } },
      "left this process's process group or session",
    ],
    [
      "a process in its own process group",
      { ...FFMPEG, lineage: { ppid: 100, pgrp: 5, session: 80 } },
      "left this process's process group or session",
    ],
    [
      "a process that is not this one's child",
      { ...FFMPEG, lineage: { ppid: 1, pgrp: 90, session: 80 } },
      "no longer this process's child",
    ],
    ["an unreadable executable", { ...FFMPEG, exe: null }, "cannot be read"],
    ["an unreadable stat", { ...FFMPEG, lineage: null }, "cannot be read"],
    ["unreadable children", { ...FFMPEG, descendants: null }, "child processes cannot be read"],
  ])("declines %s", (_name, facts, detail) => {
    expect(encoderProcessProblem(facts, SELF)).toContain(detail);
  });
});

describe("executableProblem and libx265Problem", () => {
  const real: ExecutableFacts = { elf: true, staticLibx265: true, reportsLibx265: true };

  it("accepts an ELF that reports libx265", () => {
    expect(executableProblem("/opt/x/ff-renamed", real)).toBeNull();
  });

  it.each([
    ["an unreadable executable", null, "cannot be read"],
    ["a script", { ...real, elf: false }, "not an ELF executable"],
    ["an ffmpeg without libx265", { ...real, reportsLibx265: false }, "--enable-libx265"],
  ])("declines %s", (_name, facts, detail) => {
    expect(executableProblem("/usr/bin/x", facts)).toContain(detail);
  });

  it("wants libx265 code in the executable or a mapped libx265", () => {
    expect(libx265Problem("/x", true, false)).toBeNull();
    expect(libx265Problem("/x", false, true)).toBeNull();
    expect(libx265Problem("/x", false, false)).toContain("holds no libx265 code");
    expect(libx265Problem("/x", false, null)).toContain("maps cannot be read");
  });
});

/** Watch deps over scripted `/proc` reads: the encoder is pid 7. */
function watchDeps(over: Partial<EncoderWatchDeps> = {}): EncoderWatchDeps {
  return {
    readProcess: () => FFMPEG,
    readExecutable: async () => ({ elf: true, staticLibx265: true, reportsLibx265: true }),
    threads: () => threadsOf(["S", "S", "S"], ["ffmpeg", "enc0:0:libx265", "vf#0:0"]),
    mapsLibx265: () => false,
    self: () => ({ ...SELF, exeId: "9:9" }),
    sleep: async () => {},
    now: Date.now,
    ...over,
  };
}

describe("watchEncoder", () => {
  it("paces a proven ffmpeg", async () => {
    const pacer = await watchEncoder(7, watchDeps());
    pacer.check();
    await pacer.waitUntilIdle(fast);
    await pacer.waitUntilIdle(fast);
  });

  it("declines with no pid", async () => {
    await expect(watchEncoder(undefined, watchDeps())).rejects.toBeInstanceOf(EncoderPacingError);
  });

  // The wrappers that started the real encoder outside their own process tree: named ffmpeg,
  // forwarding -buildconf to the real ffmpeg, with no child left by the time they are read.
  it.each([["a delayed double fork"], ["a daemon (setsid, then fork)"]])(
    "declines a wrapper binary that runs ffmpeg as %s: it holds no libx265 code",
    async () => {
      const wrapper = { ...FFMPEG, exe: "/opt/wrap/ffmpeg", exeId: "3:4" };
      const error = await watchEncoder(
        7,
        watchDeps({
          readProcess: () => wrapper,
          readExecutable: async () => ({ elf: true, staticLibx265: false, reportsLibx265: true }),
        }),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(EncoderPacingError);
      expect(String(error.message)).toContain("/opt/wrap/ffmpeg, which holds no libx265 code");
    },
  );

  it("accepts a shared ffmpeg once it maps libx265", async () => {
    let maps = 0;
    await watchEncoder(
      7,
      watchDeps({
        readExecutable: async () => ({ elf: true, staticLibx265: false, reportsLibx265: true }),
        mapsLibx265: () => ++maps > 3,
      }),
    );
    expect(maps).toBe(4);
  });

  it("declines a script, its interpreter running", async () => {
    const error = await watchEncoder(
      7,
      watchDeps({
        readProcess: () => ({ ...FFMPEG, exe: "/usr/bin/dash", exeId: "5:5" }),
        readExecutable: async () => ({ elf: true, staticLibx265: false, reportsLibx265: false }),
      }),
    ).catch((e) => e);
    expect(String(error.message)).toContain(
      "/usr/bin/dash, which does not report --enable-libx265",
    );
  });

  it("reads a process again while it runs this one's executable or a script that execs ffmpeg", async () => {
    const reads: string[] = [];
    const stages: EncoderProcessFacts[] = [
      { ...FFMPEG, exeId: "9:9", exe: "/usr/bin/node" },
      { ...FFMPEG, exeId: "5:5", exe: "/usr/bin/dash" },
      FFMPEG,
    ];
    await watchEncoder(
      7,
      watchDeps({
        readProcess: () => {
          const facts = stages[Math.min(reads.length, stages.length - 1)] as EncoderProcessFacts;
          reads.push(facts.exe ?? "");
          return facts;
        },
        readExecutable: async (_pid, exe) => ({
          elf: true,
          staticLibx265: exe === FFMPEG.exe,
          reportsLibx265: exe === FFMPEG.exe,
        }),
      }),
    );
    expect(reads).toEqual(["/usr/bin/node", "/usr/bin/dash", FFMPEG.exe]);
  });

  it("declines a process that never runs a proven ffmpeg", async () => {
    await expect(
      watchEncoder(7, watchDeps({ readProcess: () => ({ ...FFMPEG, exeId: "9:9" }) })),
    ).rejects.toThrow("never ran ffmpeg");
  });

  it("declines, frame by frame, a process that forks, leaves the group or execs another file", async () => {
    let facts: EncoderProcessFacts = FFMPEG;
    const pacer = await watchEncoder(7, watchDeps({ readProcess: () => facts }));
    pacer.check();
    facts = { ...FFMPEG, descendants: 2 };
    expect(() => pacer.check()).toThrow("started 2 process(es)");
    facts = { ...FFMPEG, lineage: { ppid: 100, pgrp: 7, session: 7 } };
    expect(() => pacer.check()).toThrow("process group or session");
    facts = { ...FFMPEG, exeId: "1:3" };
    expect(() => pacer.check()).toThrow("another executable");
  });

  it("does not count the first frame idle while the process runs one thread", async () => {
    let polls = 0;
    const pacer = await watchEncoder(
      7,
      watchDeps({
        threads: () => {
          polls++;
          return polls <= 4
            ? threadsOf(["S"])
            : threadsOf(["S", "S"], ["ffmpeg", "enc0:0:libx265"]);
        },
      }),
    );
    await pacer.waitUntilIdle(fast);
    // Four single-thread polls, three idle ones, and the read of the threads to hold.
    expect(polls).toBe(8);
  });

  it("declines a process with no libx265 encoder thread once its first frame has gone idle", async () => {
    // An ffmpeg that names no thread for libx265 (another encoder, or one older than 7.0).
    let clock = 0;
    const pacer = await watchEncoder(
      7,
      watchDeps({
        threads: () => threadsOf(["S", "S"], ["ffmpeg", "enc0:0:libx264"]),
        now: () => (clock += 4_000),
      }),
    );
    const error = await pacer.waitUntilIdle(fast).catch((e) => e);
    expect(error).toBeInstanceOf(EncoderPacingError);
    expect(error.message).toContain("no thread named for libx265");
    // Idle with no libx265 thread for over 10 s before it declines.
    expect(clock).toBeGreaterThan(10_000);
  });

  it("does not count the first frame idle before ffmpeg starts its libx265 thread", async () => {
    // On a loaded host ffmpeg can sit idle, its first threads up, before it starts the encoder's.
    let polls = 0;
    const pacer = await watchEncoder(
      7,
      watchDeps({
        threads: () => {
          polls++;
          return polls <= 6
            ? threadsOf(["S", "S"], ["ffmpeg", "dmx0:pipe"])
            : threadsOf(["S", "S", "S", "S"], ["ffmpeg", "dmx0:pipe", "enc0:0:libx265", "x265"]);
        },
      }),
    );
    await pacer.waitUntilIdle(fast);
    // Six idle polls without it, three with it, and the read of the threads to hold.
    expect(polls).toBe(10);
  });

  it("declines once the libx265 thread, or any thread held at the first idle, is gone", async () => {
    let threads = threadsOf(["S", "S", "S"], ["ffmpeg", "enc0:0:libx265", "vf#0:0"]);
    const pacer = await watchEncoder(7, watchDeps({ threads: () => threads }));
    await pacer.waitUntilIdle(fast);
    // New threads are fine.
    threads = [...threads, { tid: 9, name: "vf#0:0", state: "S" }];
    await pacer.waitUntilIdle(fast);
    threads = threads.filter((thread) => thread.tid !== 3);
    await expect(pacer.waitUntilIdle(fast)).rejects.toThrow("one of the encoder's threads is gone");
    threads = threadsOf(["S", "S"], ["ffmpeg", "x"]).map((t) => ({ ...t, tid: t.tid + 20 }));
    await expect(pacer.waitUntilIdle(fast)).rejects.toThrow("libx265 thread is gone");
  });
});

describe("scanExecutable", () => {
  it("finds the libx265 banner in an ELF file, across read chunks too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hdr-pacing-scan-"));
    try {
      const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
      // Placed across the 4 MiB chunk boundary.
      const padding = Buffer.alloc((4 << 20) - 10);
      const withBanner = join(dir, "with");
      writeFileSync(withBanner, Buffer.concat([elf, padding, LIBX265_BANNER, Buffer.alloc(8)]));
      expect(await scanExecutable(withBanner, LIBX265_BANNER)).toEqual({ elf: true, holds: true });
      const without = join(dir, "without");
      writeFileSync(without, Buffer.concat([elf, padding]));
      expect(await scanExecutable(without, LIBX265_BANNER)).toEqual({ elf: true, holds: false });
      const script = join(dir, "script");
      writeFileSync(script, `#!/bin/sh\necho "${LIBX265_BANNER.toString()}"\n`);
      expect(await scanExecutable(script, LIBX265_BANNER)).toEqual({ elf: false, holds: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform !== "linux")("readEncoderProcess", () => {
  it("reads a live process's executable, lineage and descendants at any depth", async () => {
    // A shell that forks a shell that forks: descendants at two levels.
    const shell = spawn("sh", ["-c", "sh -c 'sleep 5 & wait' & wait"], { stdio: "ignore" });
    try {
      await new Promise((done) => setTimeout(done, 300));
      const facts = readEncoderProcess(shell.pid ?? -1);
      expect(facts.exe).toBeTruthy();
      expect(facts.exeId).toMatch(/^\d+:\d+$/);
      expect(facts.lineage?.ppid).toBe(process.pid);
      expect(facts.descendants).toBe(2);
    } finally {
      shell.kill("SIGKILL");
    }
  });

  it("cannot read a process that does not exist", () => {
    const self = { pid: process.pid, pgrp: 0, session: 0 };
    expect(encoderProcessProblem(readEncoderProcess(2 ** 22 + 7), self)).toContain(
      "cannot be read",
    );
  });
});
