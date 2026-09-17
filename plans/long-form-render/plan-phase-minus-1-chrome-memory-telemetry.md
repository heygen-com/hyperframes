# Phase −1: Chrome memory telemetry for the long-render crash class — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `render_error` and `render_complete` carry Chrome browser/renderer RSS peaks, the last sample, whether a GPU process was present at the last sample, and which capture path ran, so the mid-capture "Target closed" class (spec §2.5, 0.7 % → 39 % by extracted frames) can be correlated with Chrome memory.

**Architecture:** A zero-dependency sampler in `@hyperframes/engine` reads OS pids of the Chrome browser process (puppeteer `browser.process()?.pid`) and its renderer/GPU children (CDP `SystemInfo.getProcessInfo`), then reads RSS per pid with `ps` (POSIX) or `tasklist` (Windows) every 2 s while a capture session is alive. Results are stored on the `CaptureSession` and pushed live through a new optional `CaptureOptions.onMemorySample` callback. The producer wires that callback to `updateCaptureObservability`, which is the only channel that survives a crash (the failure path never builds `RenderPerfSummary`). The success path additionally aggregates per-session peaks through `getCapturePerfSummary` → `perfSummary.ts`. The CLI maps both into event properties. No behaviour change to rendering.

**Tech Stack:** TypeScript, puppeteer CDP, `node:child_process` `execFile`, vitest (fake timers).

**Spec:** `plans/long-form-render/2026-09-16-long-form-render-capture-design.md` §2.5, §5 "Phase −1", §6.

## Global Constraints

- Worktree `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`; `bun install --frozen-lockfile` is done. Never work in `~/src/hyperframes`.
- Commit with `/usr/bin/git` (rtk turns `git commit` into a no-op). Never push. Never edit `.gitignore`. Never `git add -A`; the LFS fixtures `packages/producer/tests/**/output/compiled.html` always show modified and must not be staged.
- Conventional commit subject under 100 chars; last body line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt/oxlint/commitlint; fix failures, never `--no-verify`.
- No `!` non-null assertions, no `as T` casts, **no new dependencies** (no `pidusage`, no `systeminformation`).
- Tests: engine and cli `cd packages/<pkg> && bunx vitest run <file>`; producer the same for one file, `node scripts/run-test-lane.mjs unit vitest` for the lane. New producer tests must import from exactly one of `vitest` / `bun:test`.
- Sampling must never throw into the capture loop and must never block a frame: all sampling is fire-and-forget on an `unref`'d interval with a reentrancy guard.
- Windows is in scope (thousands of Target-closed events in §2.5 are win32).

---

## File map

| File                                                                                                        | Change                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/utils/processRss.ts` (new)                                                             | `sampleProcessRss(pids, exec?)` — `ps` / `tasklist` parser, never throws.                                                                                                             |
| `packages/engine/src/utils/processRss.test.ts` (new)                                                        | Parser tests with a fake exec.                                                                                                                                                        |
| `packages/engine/src/services/chromeMemorySampler.ts` (new)                                                 | `ChromeMemoryStats`, `createChromeMemorySampler(deps)` with `start/stop/stats`, pure `mergeSample`.                                                                                   |
| `packages/engine/src/services/chromeMemorySampler.test.ts` (new)                                            | Fake timers + fake deps.                                                                                                                                                              |
| `packages/engine/src/types.ts`                                                                              | `CaptureOptions.onMemorySample?`, `CapturePerfSummary.chrome*` fields; re-export `ChromeMemoryStats`.                                                                                 |
| `packages/engine/src/services/frameCapture.ts`                                                              | `CaptureSession.chromeMemory?`, start sampler at end of `initializeSession` (line ~2102), stop in `closeCaptureSession` (line ~4303), report in `getCapturePerfSummary` (line ~4556). |
| `packages/engine/src/index.ts`                                                                              | Export the new type.                                                                                                                                                                  |
| `packages/producer/src/services/render/observability.ts`                                                    | `RenderCaptureObservability` new fields (line 33–168).                                                                                                                                |
| `packages/producer/src/services/render/perfSummary.ts`                                                      | `aggregateChromeMemory(perfs)`; `RenderPerfSummary.chromeMemory`.                                                                                                                     |
| `packages/producer/src/services/renderOrchestrator.ts`                                                      | `RenderPerfSummary.chromeMemory?` (line ~420–500); `buildCaptureOptions` (line ~2967) adds `onMemorySample`; set `capturePath` next to the gate log (line ~3540).                     |
| `packages/producer/src/services/render/perfSummary-dedup.test.ts` or new `perfSummary-chromeMemory.test.ts` | Aggregation test.                                                                                                                                                                     |
| `packages/cli/src/telemetry/renderObservability.ts`                                                         | Map new capture fields into the payload.                                                                                                                                              |
| `packages/cli/src/telemetry/events.ts`                                                                      | Payload interface + `renderObservabilityEventProperties` mapping + `trackRenderComplete` props from perf.                                                                             |
| `packages/cli/src/telemetry/events.test.ts`                                                                 | Property-name assertions.                                                                                                                                                             |
| `packages/cli/src/commands/render.ts`                                                                       | Pass `perf.chromeMemory` into `trackRenderComplete` (near line 1689).                                                                                                                 |

## Names (use verbatim everywhere)

```ts
// engine
export interface ChromeMemoryStats {
  browserRssPeakMb?: number;
  rendererRssPeakMb?: number;
  rssLastMb?: number; // sum of browser + renderers + gpu at the last sample
  gpuProcessSeenLastSample?: boolean;
  samples: number; // successful samples
}
// telemetry property names (snake_case, both events)
(chrome_browser_rss_peak_mb,
  chrome_renderer_rss_peak_mb,
  chrome_rss_last_mb,
  gpu_process_seen_last_sample,
  chrome_memory_samples,
  capture_path,
  segment_index,
  segment_retries);
```

---

### Task 1: `sampleProcessRss` (engine util)

**Files:**

- Create: `packages/engine/src/utils/processRss.ts`
- Test: `packages/engine/src/utils/processRss.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ProcessRssSample {
  pid: number;
  rssMb: number;
}
export type ExecFileLike = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;
/** Never rejects. Pids that are gone or unparsable are omitted. Empty input → []. */
export async function sampleProcessRss(
  pids: readonly number[],
  exec?: ExecFileLike,
  platform?: NodeJS.Platform,
): Promise<ProcessRssSample[]>;
export function parsePsRss(stdout: string): ProcessRssSample[]; // "  123 45678\n" → [{pid:123, rssMb:45}]
export function parseTasklistCsv(pid: number, stdout: string): ProcessRssSample[]; // '"chrome.exe","123","Console","1","12,345 K"'
```

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/utils/processRss.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePsRss, parseTasklistCsv, sampleProcessRss } from "./processRss.js";

describe("parsePsRss", () => {
  it("parses pid and rss kilobytes into megabytes", () => {
    const out = "  4242 1048576\n 4243   2048\n";
    expect(parsePsRss(out)).toEqual([
      { pid: 4242, rssMb: 1024 },
      { pid: 4243, rssMb: 2 },
    ]);
  });

  it("skips blank and malformed lines", () => {
    expect(parsePsRss("\n  PID RSS\nabc def\n 7 10240\n")).toEqual([{ pid: 7, rssMb: 10 }]);
  });
});

describe("parseTasklistCsv", () => {
  it("parses the memory column with thousands separators", () => {
    const out = '"chrome.exe","4242","Console","1","1,048,576 K"\r\n';
    expect(parseTasklistCsv(4242, out)).toEqual([{ pid: 4242, rssMb: 1024 }]);
  });

  it("returns [] for the 'no tasks' message", () => {
    expect(
      parseTasklistCsv(4242, "INFO: No tasks are running which match the specified criteria."),
    ).toEqual([]);
  });
});

describe("sampleProcessRss", () => {
  it("uses one ps call for all pids on posix", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const exec = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      return { stdout: " 1 1024\n 2 2048\n" };
    };
    const result = await sampleProcessRss([1, 2], exec, "darwin");
    expect(calls).toEqual([{ file: "ps", args: ["-o", "pid=,rss=", "-p", "1,2"] }]);
    expect(result).toEqual([
      { pid: 1, rssMb: 1 },
      { pid: 2, rssMb: 2 },
    ]);
  });

  it("uses one tasklist call per pid on win32", async () => {
    const calls: string[][] = [];
    const exec = async (_file: string, args: readonly string[]) => {
      calls.push([...args]);
      return { stdout: '"chrome.exe","9","Console","1","2,048 K"\r\n' };
    };
    const result = await sampleProcessRss([9], exec, "win32");
    expect(calls).toEqual([["/FO", "CSV", "/NH", "/FI", "PID eq 9"]]);
    expect(result).toEqual([{ pid: 9, rssMb: 2 }]);
  });

  it("returns [] on empty input without calling exec", async () => {
    let called = false;
    const exec = async () => {
      called = true;
      return { stdout: "" };
    };
    expect(await sampleProcessRss([], exec, "linux")).toEqual([]);
    expect(called).toBe(false);
  });

  it("never rejects when exec fails", async () => {
    const exec = async () => {
      throw new Error("ENOENT");
    };
    expect(await sampleProcessRss([1], exec, "linux")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/utils/processRss.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/engine/src/utils/processRss.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface ProcessRssSample {
  pid: number;
  rssMb: number;
}

export type ExecFileLike = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

const KB_PER_MB = 1024;

function defaultExec(): ExecFileLike {
  // promisify lazily so vitest module mocks of child_process still take effect
  // (same reason psnr.ts does this).
  const execFileP = promisify(execFile);
  return async (file, args) => {
    const { stdout } = await execFileP(file, [...args], { windowsHide: true, timeout: 5_000 });
    return { stdout: String(stdout) };
  };
}

/** `ps -o pid=,rss=` output: one "<pid> <rss-kb>" pair per line. */
export function parsePsRss(stdout: string): ProcessRssSample[] {
  const samples: ProcessRssSample[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const rssKb = Number(match[2]);
    if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) continue;
    samples.push({ pid, rssMb: Math.round(rssKb / KB_PER_MB) });
  }
  return samples;
}

/** `tasklist /FO CSV /NH /FI "PID eq N"`: `"image","pid","session","sess#","12,345 K"`. */
export function parseTasklistCsv(pid: number, stdout: string): ProcessRssSample[] {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('"'));
  if (!line) return [];
  const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ""));
  const memCell = cells[4];
  if (typeof memCell !== "string") return [];
  const kb = Number(memCell.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(kb) || kb <= 0) return [];
  return [{ pid, rssMb: Math.round(kb / KB_PER_MB) }];
}

/**
 * Resident set size per pid, in MiB. Zero dependencies: `ps` on POSIX (one
 * call for all pids), `tasklist` on Windows (one call per pid). Never
 * rejects; a pid that exited between discovery and sampling is simply absent.
 */
export async function sampleProcessRss(
  pids: readonly number[],
  exec: ExecFileLike = defaultExec(),
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessRssSample[]> {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (unique.length === 0) return [];
  try {
    if (platform === "win32") {
      const results: ProcessRssSample[] = [];
      for (const pid of unique) {
        const { stdout } = await exec("tasklist", ["/FO", "CSV", "/NH", "/FI", `PID eq ${pid}`]);
        results.push(...parseTasklistCsv(pid, stdout));
      }
      return results;
    }
    const { stdout } = await exec("ps", ["-o", "pid=,rss=", "-p", unique.join(",")]);
    return parsePsRss(stdout);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/utils/processRss.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Real-process smoke check (posix only)**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && node --input-type=module -e "const m = await import('./src/utils/processRss.ts'); console.log(await m.sampleProcessRss([process.pid]))"` — if Node cannot import `.ts` directly here, skip this step; the unit tests cover the parser and Step 3 of Task 2 covers the wiring.
Expected: `[ { pid: <n>, rssMb: <30–100> } ]`.

- [ ] **Step 6: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/engine/src/utils/processRss.ts packages/engine/src/utils/processRss.test.ts
bunx oxlint packages/engine/src/utils/processRss.ts packages/engine/src/utils/processRss.test.ts
/usr/bin/git add packages/engine/src/utils/processRss.ts packages/engine/src/utils/processRss.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(engine): zero-dependency per-pid RSS sampler (ps / tasklist)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: `createChromeMemorySampler` (engine service, pure core)

**Files:**

- Create: `packages/engine/src/services/chromeMemorySampler.ts`
- Test: `packages/engine/src/services/chromeMemorySampler.test.ts`
- Modify: `packages/engine/src/types.ts` (add `ChromeMemoryStats` re-export target + `CaptureOptions.onMemorySample`)

**Interfaces:**

- Consumes: `sampleProcessRss` (Task 1).
- Produces:

```ts
export interface ChromeMemoryStats {
  browserRssPeakMb?: number;
  rendererRssPeakMb?: number;
  rssLastMb?: number;
  gpuProcessSeenLastSample?: boolean;
  samples: number;
}
export interface ChromePids {
  browser?: number;
  renderers: number[];
  gpu: number[];
}
export interface ChromeMemorySamplerDeps {
  getPids: () => Promise<ChromePids>;
  sampleRss: (pids: readonly number[]) => Promise<ProcessRssSample[]>;
  intervalMs: number;
  onSample?: (stats: ChromeMemoryStats) => void;
  setIntervalFn?: typeof setInterval; // test seam; default global setInterval
  clearIntervalFn?: typeof clearInterval;
}
export interface ChromeMemorySampler {
  start(): void;
  stop(): void;
  stats(): ChromeMemoryStats;
  sampleOnce(): Promise<void>;
}
export function createChromeMemorySampler(deps: ChromeMemorySamplerDeps): ChromeMemorySampler;
export function mergeSample(
  prev: ChromeMemoryStats,
  pids: ChromePids,
  rss: readonly ProcessRssSample[],
): ChromeMemoryStats; // pure
// CaptureOptions gains:
//   onMemorySample?: (stats: ChromeMemoryStats) => void;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/services/chromeMemorySampler.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChromeMemorySampler,
  mergeSample,
  type ChromeMemoryStats,
  type ChromePids,
} from "./chromeMemorySampler.js";

const empty: ChromeMemoryStats = { samples: 0 };

describe("mergeSample", () => {
  it("tracks browser and renderer peaks separately and sums the last sample", () => {
    const pids: ChromePids = { browser: 1, renderers: [2, 3], gpu: [4] };
    const first = mergeSample(empty, pids, [
      { pid: 1, rssMb: 100 },
      { pid: 2, rssMb: 300 },
      { pid: 3, rssMb: 200 },
      { pid: 4, rssMb: 50 },
    ]);
    expect(first).toEqual({
      browserRssPeakMb: 100,
      rendererRssPeakMb: 300,
      rssLastMb: 650,
      gpuProcessSeenLastSample: true,
      samples: 1,
    });
    const second = mergeSample(first, { browser: 1, renderers: [2], gpu: [] }, [
      { pid: 1, rssMb: 90 },
      { pid: 2, rssMb: 250 },
    ]);
    expect(second).toEqual({
      browserRssPeakMb: 100,
      rendererRssPeakMb: 300,
      rssLastMb: 340,
      gpuProcessSeenLastSample: false,
      samples: 2,
    });
  });

  it("does not count a sample that returned no rows", () => {
    expect(mergeSample(empty, { renderers: [], gpu: [] }, [])).toEqual(empty);
  });
});

describe("createChromeMemorySampler", () => {
  afterEach(() => vi.useRealTimers());

  it("samples on the interval, reports via onSample, and stops cleanly", async () => {
    vi.useFakeTimers();
    const seen: ChromeMemoryStats[] = [];
    const sampler = createChromeMemorySampler({
      getPids: async () => ({ browser: 1, renderers: [2], gpu: [] }),
      sampleRss: async () => [
        { pid: 1, rssMb: 10 },
        { pid: 2, rssMb: 20 },
      ],
      intervalMs: 1000,
      onSample: (s) => seen.push(s),
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(2500);
    sampler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.length).toBe(2);
    expect(sampler.stats()).toEqual({
      browserRssPeakMb: 10,
      rendererRssPeakMb: 20,
      rssLastMb: 30,
      gpuProcessSeenLastSample: false,
      samples: 2,
    });
  });

  it("never lets a dependency error escape and keeps sampling", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sampler = createChromeMemorySampler({
      getPids: async () => {
        calls += 1;
        if (calls === 1) throw new Error("cdp gone");
        return { browser: 1, renderers: [], gpu: [] };
      },
      sampleRss: async () => [{ pid: 1, rssMb: 5 }],
      intervalMs: 100,
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(250);
    sampler.stop();
    expect(sampler.stats().samples).toBe(1);
  });

  it("skips a tick while the previous sample is still in flight", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const sampler = createChromeMemorySampler({
      getPids: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 350));
        inFlight -= 1;
        return { browser: 1, renderers: [], gpu: [] };
      },
      sampleRss: async () => [{ pid: 1, rssMb: 1 }],
      intervalMs: 100,
    });
    sampler.start();
    await vi.advanceTimersByTimeAsync(1000);
    sampler.stop();
    expect(maxInFlight).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/services/chromeMemorySampler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/engine/src/services/chromeMemorySampler.ts`:

```ts
import type { ProcessRssSample } from "../utils/processRss.js";

/**
 * Chrome process memory observed during one capture session. Peaks are
 * per-process-type maxima across samples; `rssLastMb` is the whole tree at
 * the most recent successful sample. Surfaced on render_error /
 * render_complete so the long-render "Target closed" class (spec §2.5) can be
 * correlated with memory instead of guessed at.
 */
export interface ChromeMemoryStats {
  browserRssPeakMb?: number;
  rendererRssPeakMb?: number;
  rssLastMb?: number;
  gpuProcessSeenLastSample?: boolean;
  samples: number;
}

export interface ChromePids {
  browser?: number;
  renderers: number[];
  gpu: number[];
}

export interface ChromeMemorySamplerDeps {
  getPids: () => Promise<ChromePids>;
  sampleRss: (pids: readonly number[]) => Promise<ProcessRssSample[]>;
  intervalMs: number;
  onSample?: (stats: ChromeMemoryStats) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface ChromeMemorySampler {
  start(): void;
  stop(): void;
  stats(): ChromeMemoryStats;
  /** One synchronous-to-the-caller sample; used by tests and by close(). */
  sampleOnce(): Promise<void>;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** Pure merge of one sample into the running stats. Empty `rss` → unchanged. */
export function mergeSample(
  prev: ChromeMemoryStats,
  pids: ChromePids,
  rss: readonly ProcessRssSample[],
): ChromeMemoryStats {
  if (rss.length === 0) return prev;
  const byPid = new Map(rss.map((s) => [s.pid, s.rssMb]));
  const browserMb = pids.browser === undefined ? undefined : byPid.get(pids.browser);
  const rendererMbs = pids.renderers
    .map((p) => byPid.get(p))
    .filter((v): v is number => v !== undefined);
  const gpuMbs = pids.gpu.map((p) => byPid.get(p)).filter((v): v is number => v !== undefined);
  const rendererMax = rendererMbs.length > 0 ? Math.max(...rendererMbs) : undefined;
  const total = rss.reduce((sum, s) => sum + s.rssMb, 0);
  return {
    browserRssPeakMb: maxDefined(prev.browserRssPeakMb, browserMb),
    rendererRssPeakMb: maxDefined(prev.rendererRssPeakMb, rendererMax),
    rssLastMb: total,
    gpuProcessSeenLastSample: gpuMbs.length > 0,
    samples: prev.samples + 1,
  };
}

export function createChromeMemorySampler(deps: ChromeMemorySamplerDeps): ChromeMemorySampler {
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let stats: ChromeMemoryStats = { samples: 0 };
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const sampleOnce = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const pids = await deps.getPids();
      const all = [pids.browser, ...pids.renderers, ...pids.gpu].filter(
        (p): p is number => typeof p === "number",
      );
      const rss = await deps.sampleRss(all);
      const next = mergeSample(stats, pids, rss);
      if (next !== stats) {
        stats = next;
        deps.onSample?.(stats);
      }
    } catch {
      // Sampling is observability only; a CDP or ps failure must never reach
      // the capture loop. The next tick retries.
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (timer !== null) return;
      // Node's Timeout has unref(); the engine already relies on it
      // (utils/processTracker.ts line ~40). Keeps the interval from holding
      // the process open if a caller forgets stop().
      timer = setIntervalFn(() => {
        void sampleOnce();
      }, deps.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    },
    stats: () => stats,
    sampleOnce,
  };
}
```

`timer.unref()` typechecks because the engine compiles against Node typings (`setInterval` returns `NodeJS.Timeout`); `processTracker.ts` line ~40 does the same. In the fake-timer tests `vi.useFakeTimers()` returns an object with `unref`, so the call is safe there too.

- [ ] **Step 4: Add the callback to `CaptureOptions`**

In `packages/engine/src/types.ts`, inside `export interface CaptureOptions {` (find with `grep -n "export interface CaptureOptions" packages/engine/src/types.ts`), add after `compositionDurationSeconds?: number;`:

```ts
  /**
   * Live Chrome memory samples during capture (browser/renderer RSS peaks,
   * last total, GPU process presence). Invoked from an unref'd interval; must
   * not throw. The producer forwards these to capture observability so a
   * crash mid-render still reports the last known memory state.
   */
  onMemorySample?: (stats: ChromeMemoryStats) => void;
```

and at the top of `types.ts` add `import type { ChromeMemoryStats } from "./services/chromeMemorySampler.js";` (check the file's existing import style; if it avoids importing from services, instead move the `ChromeMemoryStats` interface into `types.ts` and import it from there in `chromeMemorySampler.ts`; either way the name is `ChromeMemoryStats` and it is exported from `@hyperframes/engine`).

In `packages/engine/src/index.ts` add to the exports: `export type { ChromeMemoryStats } from "./services/chromeMemorySampler.js";` (or from `./types.js` if you moved it) and `export { createChromeMemorySampler } from "./services/chromeMemorySampler.js";`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/services/chromeMemorySampler.test.ts && bunx tsc --noEmit -p .`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/engine/src/services/chromeMemorySampler.ts packages/engine/src/services/chromeMemorySampler.test.ts packages/engine/src/types.ts packages/engine/src/index.ts
bunx oxlint packages/engine/src/services/chromeMemorySampler.ts packages/engine/src/services/chromeMemorySampler.test.ts packages/engine/src/types.ts packages/engine/src/index.ts
/usr/bin/git add packages/engine/src/services/chromeMemorySampler.ts packages/engine/src/services/chromeMemorySampler.test.ts packages/engine/src/types.ts packages/engine/src/index.ts
/usr/bin/git commit -F - <<'EOF'
feat(engine): Chrome memory sampler with live onMemorySample capture option

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Wire the sampler into the capture session

**Files:**

- Modify: `packages/engine/src/services/frameCapture.ts` (`CaptureSession` interface ~line 150; `initializeSession` ~2102; `closeCaptureSession` ~4303; `getCapturePerfSummary` ~4556)
- Modify: `packages/engine/src/types.ts` (`CapturePerfSummary` fields)
- Test: `packages/engine/src/services/frameCapture-chromeMemory.test.ts` (new; pure helper only)

**Interfaces:**

- Consumes: `createChromeMemorySampler`, `sampleProcessRss`.
- Produces: `CaptureSession.chromeMemory?: ChromeMemorySampler`; `CapturePerfSummary` gains `chromeBrowserRssPeakMb?`, `chromeRendererRssPeakMb?`, `chromeRssLastMb?`, `chromeGpuProcessSeenLastSample?`, `chromeMemorySamples?` (all optional numbers/boolean); exported pure helper `classifyChromeProcesses(browserPid, processInfo)`.

- [ ] **Step 1: Write the failing test for the pid classifier**

Create `packages/engine/src/services/frameCapture-chromeMemory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyChromeProcesses } from "./frameCapture.js";

describe("classifyChromeProcesses", () => {
  it("splits CDP SystemInfo.getProcessInfo rows by type and keeps the browser pid", () => {
    const pids = classifyChromeProcesses(100, [
      { type: "browser", id: 100, cpuTime: 0 },
      { type: "renderer", id: 101, cpuTime: 0 },
      { type: "renderer", id: 102, cpuTime: 0 },
      { type: "GPU", id: 103, cpuTime: 0 },
      { type: "utility", id: 104, cpuTime: 0 },
    ]);
    expect(pids).toEqual({ browser: 100, renderers: [101, 102], gpu: [103] });
  });

  it("works without a browser pid", () => {
    expect(classifyChromeProcesses(undefined, [{ type: "renderer", id: 7, cpuTime: 0 }])).toEqual({
      renderers: [7],
      gpu: [],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/services/frameCapture-chromeMemory.test.ts`
Expected: FAIL — `classifyChromeProcesses` is not exported.

- [ ] **Step 3: Implement in `frameCapture.ts`**

(a) Imports, near the other `./` imports at the top of `frameCapture.ts`:

```ts
import {
  createChromeMemorySampler,
  type ChromeMemorySampler,
  type ChromePids,
} from "./chromeMemorySampler.js";
import { sampleProcessRss } from "../utils/processRss.js";
```

(b) `CaptureSession` interface (line ~150, next to `staticDedupCount?`): add

```ts
  /** Live Chrome memory sampler; started in initializeSession, stopped in closeCaptureSession. */
  chromeMemory?: ChromeMemorySampler;
```

(c) Add the pure classifier next to `getCapturePerfSummary` (anywhere at module scope; it is exported):

```ts
/** Shape of one `SystemInfo.getProcessInfo` row; only the fields we read. */
export interface CdpProcessInfoRow {
  type: string;
  id: number;
  cpuTime: number;
}

/** Group Chrome child pids by role. `browser` comes from puppeteer, not CDP. */
export function classifyChromeProcesses(
  browserPid: number | undefined,
  processInfo: readonly CdpProcessInfoRow[],
): ChromePids {
  const renderers: number[] = [];
  const gpu: number[] = [];
  for (const row of processInfo) {
    if (row.type === "renderer") renderers.push(row.id);
    else if (row.type === "GPU") gpu.push(row.id);
  }
  return browserPid === undefined ? { renderers, gpu } : { browser: browserPid, renderers, gpu };
}

const CHROME_MEMORY_SAMPLE_MS_DEFAULT = 2_000;

function resolveChromeMemorySampleMs(): number {
  const raw = process.env.HF_CHROME_MEMORY_SAMPLE_MS;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 250 ? parsed : CHROME_MEMORY_SAMPLE_MS_DEFAULT;
}

function startChromeMemorySampler(session: CaptureSession): void {
  if (session.chromeMemory) return;
  if (process.env.HF_CHROME_MEMORY_SAMPLER === "false") return;
  const sampler = createChromeMemorySampler({
    intervalMs: resolveChromeMemorySampleMs(),
    onSample: session.options.onMemorySample,
    sampleRss: (pids) => sampleProcessRss(pids),
    getPids: async () => {
      const browserPid = session.browser.process()?.pid;
      const cdp = await session.page.createCDPSession();
      try {
        const info = await cdp.send("SystemInfo.getProcessInfo");
        return classifyChromeProcesses(browserPid, info.processInfo);
      } finally {
        await cdp.detach().catch(() => {});
      }
    },
  });
  session.chromeMemory = sampler;
  sampler.start();
}
```

Puppeteer types `cdp.send("SystemInfo.getProcessInfo")` as `Protocol.SystemInfo.GetProcessInfoResponse` whose `processInfo` is `ProcessInfo[]` with `type: string; id: number; cpuTime: number` — structurally compatible with `CdpProcessInfoRow`, no cast needed.

(d) At the end of `initializeSession` (line ~2102; find the last statement before the function returns, after `session.isInitialized = true` or equivalent) add:

```ts
startChromeMemorySampler(session);
```

(e) At the start of `closeCaptureSession` (line ~4303, before the static-dedup log block) add:

```ts
if (session.chromeMemory) {
  session.chromeMemory.stop();
  // One last sample so the summary reflects the session's end state, not a
  // point up to `intervalMs` earlier. Best effort; the page may be gone.
  await session.chromeMemory.sampleOnce();
}
```

(f) In `getCapturePerfSummary` (line ~4556), inside the returned object after `gpuRenderer: session.gpuRenderer,` add:

```ts
    chromeBrowserRssPeakMb: session.chromeMemory?.stats().browserRssPeakMb,
    chromeRendererRssPeakMb: session.chromeMemory?.stats().rendererRssPeakMb,
    chromeRssLastMb: session.chromeMemory?.stats().rssLastMb,
    chromeGpuProcessSeenLastSample: session.chromeMemory?.stats().gpuProcessSeenLastSample,
    chromeMemorySamples: session.chromeMemory?.stats().samples,
```

(g) In `packages/engine/src/types.ts`, in `CapturePerfSummary` after `gpuRenderer` (or at the end of the interface) add:

```ts
  /** Chrome process memory (spec: long-form render capture, Phase −1). Undefined when the sampler was disabled. */
  chromeBrowserRssPeakMb?: number;
  chromeRendererRssPeakMb?: number;
  chromeRssLastMb?: number;
  chromeGpuProcessSeenLastSample?: boolean;
  chromeMemorySamples?: number;
```

- [ ] **Step 4: Run the tests and typecheck; run the engine suite files that exercise sessions**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/engine && bunx vitest run src/services/frameCapture-chromeMemory.test.ts && bunx tsc --noEmit -p . && bunx vitest run src/services/frameCapture-constructionOwnership.test.ts src/services/frameCapture-freshFallback.test.ts`
Expected: all PASS. If a frameCapture test builds a fake `CaptureSession` object literal and now fails typecheck, `chromeMemory` is optional so it should not; if it fails because the fake `page` lacks `createCDPSession`, the sampler only calls it from the interval which those tests never advance — do not add `createCDPSession` to fakes.

- [ ] **Step 5: Live smoke (macOS/Linux)**

Run a short real render with the worktree build using the long-form fixture generator (Phase 0, Task 4; if Phase 0 has not landed yet, copy `gen.mjs` from that plan into `/tmp`):

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
mkdir -p /tmp/hf-mem-smoke/assets && cd /tmp/hf-mem-smoke
ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -t 10 -c:v libx264 -preset ultrafast -pix_fmt yuv420p assets/long.mp4
DUR=10 node ~/src/wt/hyperframes/nle-render-spec/packages/producer/tests/long-form/gen.mjs
HF_CHROME_MEMORY_SAMPLE_MS=500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 10 -w 1 --quality draft -o out.mp4
ls -la out.mp4
```

Expected: the render completes and stderr has no line mentioning `SystemInfo` or `ps:`. Values are not visible yet; Task 4 wires them to observability and Task 5's step 7 reads them back. Clean up: `cd /tmp && rm -rf hf-mem-smoke`.

- [ ] **Step 6: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/engine/src/services/frameCapture.ts packages/engine/src/services/frameCapture-chromeMemory.test.ts packages/engine/src/types.ts
bunx oxlint packages/engine/src/services/frameCapture.ts packages/engine/src/services/frameCapture-chromeMemory.test.ts packages/engine/src/types.ts
/usr/bin/git add packages/engine/src/services/frameCapture.ts packages/engine/src/services/frameCapture-chromeMemory.test.ts packages/engine/src/types.ts
/usr/bin/git commit -F - <<'EOF'
feat(engine): sample Chrome process memory per capture session

Start a 2 s unref'd sampler in initializeSession, stop it in
closeCaptureSession, and report peaks on CapturePerfSummary. Pids come from
puppeteer (browser) and CDP SystemInfo.getProcessInfo (renderer, GPU).
Disable with HF_CHROME_MEMORY_SAMPLER=false; cadence HF_CHROME_MEMORY_SAMPLE_MS.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Producer observability (live route) and perf summary (aggregate route)

**Files:**

- Modify: `packages/producer/src/services/render/observability.ts:33-168` (`RenderCaptureObservability`)
- Modify: `packages/producer/src/services/render/perfSummary.ts` (`aggregateChromeMemory`, `buildRenderPerfSummary` output)
- Modify: `packages/producer/src/services/renderOrchestrator.ts` (`RenderPerfSummary` ~420–500; `buildCaptureOptions` ~2967; `capturePath` near the gate log ~3540)
- Test: `packages/producer/src/services/render/perfSummary-chromeMemory.test.ts` (new)

**Interfaces:**

- Consumes: `CapturePerfSummary.chrome*` (Task 3), `CaptureOptions.onMemorySample` (Task 2).
- Produces:

```ts
// observability.ts — RenderCaptureObservability gains:
chromeBrowserRssPeakMb?: number;
chromeRendererRssPeakMb?: number;
chromeRssLastMb?: number;
chromeGpuProcessSeenLastSample?: boolean;
chromeMemorySamples?: number;
capturePath?: "streaming" | "disk" | "segmented" | "hdr_layered";
segmentIndex?: number;   // set by Phase 2a
segmentRetries?: number; // set by Phase 2c
// renderOrchestrator.ts — RenderPerfSummary gains:
chromeMemory?: { browserRssPeakMb?: number; rendererRssPeakMb?: number; rssLastMb?: number; gpuProcessSeenLastSample?: boolean; samples: number };
// perfSummary.ts
export function aggregateChromeMemory(perfs: CapturePerfSummary[]): RenderPerfSummary["chromeMemory"];
```

- [ ] **Step 1: Write the failing aggregation test**

Create `packages/producer/src/services/render/perfSummary-chromeMemory.test.ts` (copy the `baseInput` helper from `perfSummary-dedup.test.ts` lines 1–35 verbatim, then):

```ts
function perf(overrides: Partial<CapturePerfSummary>): CapturePerfSummary {
  return {
    frames: 10,
    avgTotalMs: 1,
    avgSeekMs: 1,
    avgBeforeCaptureMs: 0,
    avgScreenshotMs: 0,
    p50TotalMs: 1,
    p95TotalMs: 1,
    p99TotalMs: 1,
    staticDedupReused: 0,
    staticDedupEnabled: false,
    staticDedupArmed: false,
    staticDedupPredicted: 0,
    ...overrides,
  };
}

describe("aggregateChromeMemory", () => {
  it("takes the max peak across workers and the sum of samples", () => {
    const summary = buildRenderPerfSummary(
      baseInput([
        perf({
          chromeBrowserRssPeakMb: 100,
          chromeRendererRssPeakMb: 900,
          chromeRssLastMb: 1000,
          chromeGpuProcessSeenLastSample: true,
          chromeMemorySamples: 5,
        }),
        perf({
          chromeBrowserRssPeakMb: 120,
          chromeRendererRssPeakMb: 700,
          chromeRssLastMb: 800,
          chromeGpuProcessSeenLastSample: false,
          chromeMemorySamples: 4,
        }),
      ]),
    );
    expect(summary.chromeMemory).toEqual({
      browserRssPeakMb: 120,
      rendererRssPeakMb: 900,
      rssLastMb: 1800,
      gpuProcessSeenLastSample: true,
      samples: 9,
    });
  });

  it("is undefined when no session sampled", () => {
    const summary = buildRenderPerfSummary(baseInput([perf({})]));
    expect(summary.chromeMemory).toBeUndefined();
  });
});
```

If `CapturePerfSummary` has other required fields the `perf()` helper misses, the typechecker names them; add them with zero values.

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx vitest run src/services/render/perfSummary-chromeMemory.test.ts`
Expected: FAIL — `chromeMemory` undefined in the first test.

- [ ] **Step 3: Add the types**

(a) `observability.ts`, inside `RenderCaptureObservability` after `memoryExhaustionDetected?: boolean;` add:

```ts
  /**
   * Chrome process memory from the engine's per-session sampler (Phase −1 of
   * the long-form render plan). Updated live during capture so a
   * render_error still carries the last known state.
   */
  chromeBrowserRssPeakMb?: number;
  chromeRendererRssPeakMb?: number;
  chromeRssLastMb?: number;
  chromeGpuProcessSeenLastSample?: boolean;
  chromeMemorySamples?: number;
  /** Which capture stage ran. Set once the streaming gate resolves. */
  capturePath?: "streaming" | "disk" | "segmented" | "hdr_layered";
  /** Segmented capture only (Phase 2): current segment and retries so far. */
  segmentIndex?: number;
  segmentRetries?: number;
```

If `observability.ts` keeps an allow-list of capture keys (look at line ~242 `"browserGpuMode",` inside an array), add the eight new keys to it.

(b) `renderOrchestrator.ts`, in `RenderPerfSummary` after `peakHeapUsedMb?: number;` add:

```ts
  /** Chrome process memory aggregated across capture sessions (max of peaks, sum of samples). */
  chromeMemory?: {
    browserRssPeakMb?: number;
    rendererRssPeakMb?: number;
    rssLastMb?: number;
    gpuProcessSeenLastSample?: boolean;
    samples: number;
  };
```

- [ ] **Step 4: Aggregate in `perfSummary.ts`**

Add next to `aggregateDedup`:

```ts
function maxDefined(values: Array<number | undefined>): number | undefined {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length > 0 ? Math.max(...present) : undefined;
}

export function aggregateChromeMemory(
  perfs: CapturePerfSummary[],
): RenderPerfSummary["chromeMemory"] {
  const sampled = perfs.filter((p) => (p.chromeMemorySamples ?? 0) > 0);
  if (sampled.length === 0) return undefined;
  return {
    browserRssPeakMb: maxDefined(sampled.map((p) => p.chromeBrowserRssPeakMb)),
    rendererRssPeakMb: maxDefined(sampled.map((p) => p.chromeRendererRssPeakMb)),
    // Last samples are per session; summing approximates the whole fleet's
    // footprint at the end of capture (workers run concurrently).
    rssLastMb: sampled.reduce((sum, p) => sum + (p.chromeRssLastMb ?? 0), 0),
    gpuProcessSeenLastSample: sampled.some((p) => p.chromeGpuProcessSeenLastSample === true),
    samples: sampled.reduce((sum, p) => sum + (p.chromeMemorySamples ?? 0), 0),
  };
}
```

In `buildRenderPerfSummary`'s returned object, after `staticDedup: aggregateDedup(input.dedupPerfs),` add:

```ts
    chromeMemory: aggregateChromeMemory(input.dedupPerfs),
```

- [ ] **Step 5: Live route in the orchestrator**

In `renderOrchestrator.ts`, find `const buildCaptureOptions = (): CaptureOptions => ({` (line ~2967). Add a property to the returned object:

```ts
      onMemorySample: (stats) => {
        updateCaptureObservability({
          chromeBrowserRssPeakMb: stats.browserRssPeakMb,
          chromeRendererRssPeakMb: stats.rendererRssPeakMb,
          chromeRssLastMb: stats.rssLastMb,
          chromeGpuProcessSeenLastSample: stats.gpuProcessSeenLastSample,
          chromeMemorySamples: stats.samples,
        });
      },
```

`updateCaptureObservability` is declared at line ~2390 (`const updateCaptureObservability = createCaptureObservabilityUpdater(captureObservability);`), which is before `buildCaptureOptions`, so it is in scope. With parallel workers each session reports its own stats through the same callback; the observability record then holds the most recent session's values, which is acceptable for the failure path (the aggregate route covers success).

Then, directly after the `log.info("streaming-encode gate", {...})` call (line ~3550), add:

```ts
updateCaptureObservability({
  capturePath: useLayeredComposite ? "hdr_layered" : useStreamingEncode ? "streaming" : "disk",
});
```

`useLayeredComposite` is the local the HDR branch already uses (grep `useLayeredComposite` in the function to confirm the exact name in scope at that line; if it is named differently there, use that name).

- [ ] **Step 6: Run tests and typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/producer && bunx tsc --noEmit -p . && bunx vitest run src/services/render/perfSummary-chromeMemory.test.ts src/services/render/observability.test.ts src/services/render/perfSummary-dedup.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/producer/src/services/render/observability.ts packages/producer/src/services/render/perfSummary.ts packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/render/perfSummary-chromeMemory.test.ts
bunx oxlint packages/producer/src/services/render/observability.ts packages/producer/src/services/render/perfSummary.ts packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/render/perfSummary-chromeMemory.test.ts
/usr/bin/git add packages/producer/src/services/render/observability.ts packages/producer/src/services/render/perfSummary.ts packages/producer/src/services/renderOrchestrator.ts packages/producer/src/services/render/perfSummary-chromeMemory.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(producer): carry Chrome memory and capture path on observability and perf summary

Live route through updateCaptureObservability survives a crash; aggregate
route through CapturePerfSummary feeds render_complete.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: CLI telemetry mapping

**Files:**

- Modify: `packages/cli/src/telemetry/renderObservability.ts` (the object literal starting ~line 20)
- Modify: `packages/cli/src/telemetry/events.ts` (`RenderObservabilityTelemetryPayload` interface ~line 60–140, `renderObservabilityEventProperties` ~line 90–160, `trackRenderComplete` props ~line 237–340 and its `trackEvent` body ~line 420–440)
- Modify: `packages/cli/src/commands/render.ts` (~line 1689, where `staticDedup*` props are passed)
- Test: `packages/cli/src/telemetry/events.test.ts`

**Interfaces:**

- Consumes: `RenderCaptureObservability.chrome*`, `.capturePath`, `.segmentIndex`, `.segmentRetries`; `RenderPerfSummary.chromeMemory`.
- Produces event properties: `chrome_browser_rss_peak_mb`, `chrome_renderer_rss_peak_mb`, `chrome_rss_last_mb`, `gpu_process_seen_last_sample`, `chrome_memory_samples`, `capture_path`, `segment_index`, `segment_retries` on both `render_error` and `render_complete`.

- [ ] **Step 1: Write the failing test**

Open `packages/cli/src/telemetry/events.test.ts`. The file mocks `./client.js` with `const trackEvent = vi.fn()` (line 2) and reads emitted properties as `trackEvent.mock.calls[0]?.[1] as Record<string, unknown>` (lines 205, 224, …; the `as` is this test file's established convention). A `beforeEach` clears the mocks. Add inside the existing `describe` that holds the `render_error` tests:

```ts
it("maps Chrome memory and capture path observability onto render_error", () => {
  trackRenderError({
    fps: 30,
    quality: "draft",
    docker: false,
    captureChromeBrowserRssPeakMb: 210,
    captureChromeRendererRssPeakMb: 1900,
    captureChromeRssLastMb: 2400,
    captureChromeGpuProcessSeenLastSample: true,
    captureChromeMemorySamples: 42,
    captureCapturePath: "streaming",
    captureSegmentIndex: 3,
    captureSegmentRetries: 1,
  });
  expect(trackEvent).toHaveBeenCalledWith("render_error", expect.any(Object), undefined);
  const props = trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(props).toMatchObject({
    chrome_browser_rss_peak_mb: 210,
    chrome_renderer_rss_peak_mb: 1900,
    chrome_rss_last_mb: 2400,
    gpu_process_seen_last_sample: true,
    chrome_memory_samples: 42,
    capture_path: "streaming",
    segment_index: 3,
    segment_retries: 1,
  });
});
```

If `trackRenderError` is called with a third argument in this file's other tests (a `distinctId`), match that arity in the `toHaveBeenCalledWith` line; otherwise `undefined` is correct because the function passes `props.distinctId` through.

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/cli && bunx vitest run src/telemetry/events.test.ts -t "Chrome memory"`
Expected: FAIL — unknown props / missing keys.

- [ ] **Step 3: Payload interface + mapping in `events.ts`**

In `RenderObservabilityTelemetryPayload`, after `captureParallelStream?: string;` add:

```ts
  /** Chrome memory from the engine sampler (Phase −1, long-form render plan). */
  captureChromeBrowserRssPeakMb?: number;
  captureChromeRendererRssPeakMb?: number;
  captureChromeRssLastMb?: number;
  captureChromeGpuProcessSeenLastSample?: boolean;
  captureChromeMemorySamples?: number;
  captureCapturePath?: string;
  captureSegmentIndex?: number;
  captureSegmentRetries?: number;
```

In `renderObservabilityEventProperties`, after `capture_parallel_stream: props.captureParallelStream,` add:

```ts
    chrome_browser_rss_peak_mb: props.captureChromeBrowserRssPeakMb,
    chrome_renderer_rss_peak_mb: props.captureChromeRendererRssPeakMb,
    chrome_rss_last_mb: props.captureChromeRssLastMb,
    gpu_process_seen_last_sample: props.captureChromeGpuProcessSeenLastSample,
    chrome_memory_samples: props.captureChromeMemorySamples,
    capture_path: props.captureCapturePath,
    segment_index: props.captureSegmentIndex,
    segment_retries: props.captureSegmentRetries,
```

In `trackRenderComplete`'s props type (near `peakMemoryMb?: number;` ~line 327) add:

```ts
    // Aggregate Chrome memory (RenderPerfSummary.chromeMemory); overrides the
    // live observability values when both are present.
    chromeBrowserRssPeakMb?: number;
    chromeRendererRssPeakMb?: number;
    chromeRssLastMb?: number;
    chromeGpuProcessSeenLastSample?: boolean;
    chromeMemorySamples?: number;
```

and in its `trackEvent("render_complete", {...})` body, after the `...renderObservabilityEventProperties(props)` spread (so these win), add:

```ts
      chrome_browser_rss_peak_mb: props.chromeBrowserRssPeakMb ?? props.captureChromeBrowserRssPeakMb,
      chrome_renderer_rss_peak_mb: props.chromeRendererRssPeakMb ?? props.captureChromeRendererRssPeakMb,
      chrome_rss_last_mb: props.chromeRssLastMb ?? props.captureChromeRssLastMb,
      gpu_process_seen_last_sample:
        props.chromeGpuProcessSeenLastSample ?? props.captureChromeGpuProcessSeenLastSample,
      chrome_memory_samples: props.chromeMemorySamples ?? props.captureChromeMemorySamples,
```

If the spread is placed after explicit keys in that object today, keep the file's ordering convention and rely on `??` as written.

- [ ] **Step 4: Map observability in `renderObservability.ts`**

In the returned object, after `captureParallelStream: capture.captureParallelStream,` add:

```ts
    captureChromeBrowserRssPeakMb: capture.chromeBrowserRssPeakMb,
    captureChromeRendererRssPeakMb: capture.chromeRendererRssPeakMb,
    captureChromeRssLastMb: capture.chromeRssLastMb,
    captureChromeGpuProcessSeenLastSample: capture.chromeGpuProcessSeenLastSample,
    captureChromeMemorySamples: capture.chromeMemorySamples,
    captureCapturePath: capture.capturePath,
    captureSegmentIndex: capture.segmentIndex,
    captureSegmentRetries: capture.segmentRetries,
```

- [ ] **Step 5: Pass the aggregate from `render.ts`**

Near line 1689 (the `staticDedupEnabled: perf?.staticDedup?.enabled,` group inside the `trackRenderComplete({...})` call) add:

```ts
    chromeBrowserRssPeakMb: perf?.chromeMemory?.browserRssPeakMb,
    chromeRendererRssPeakMb: perf?.chromeMemory?.rendererRssPeakMb,
    chromeRssLastMb: perf?.chromeMemory?.rssLastMb,
    chromeGpuProcessSeenLastSample: perf?.chromeMemory?.gpuProcessSeenLastSample,
    chromeMemorySamples: perf?.chromeMemory?.samples,
```

- [ ] **Step 6: Run tests and typecheck**

Run: `cd ~/src/wt/hyperframes/nle-render-spec/packages/cli && bunx tsc --noEmit -p . && bunx vitest run src/telemetry/events.test.ts`
Expected: PASS.

- [ ] **Step 7: End-to-end check that the properties leave the process**

`--debug` makes the producer write `perf-summary.json` (with the observability summary) under `<packages/producer>/.debug/<work dir>/` (renderOrchestrator.ts line ~2265 and ~2344). Render the 10 s fixture from Task 3 step 5 and read that file:

```sh
cd ~/src/wt/hyperframes/nle-render-spec && bun run build
cd /tmp/hf-mem-smoke   # from Task 3 step 5; recreate it if you cleaned up
HF_CHROME_MEMORY_SAMPLE_MS=500 node ~/src/wt/hyperframes/nle-render-spec/packages/cli/dist/cli.js render a-single --fps 10 -w 1 --quality draft --debug -o out.mp4
f=$(ls -t ~/src/wt/hyperframes/nle-render-spec/packages/producer/.debug/*/perf-summary.json | head -1); echo "$f"
grep -oE '"(chromeMemory|capturePath|chromeRendererRssPeakMb|chromeMemorySamples)"[^}]{0,120}' "$f" | head -5
cd /tmp && rm -rf hf-mem-smoke
```

Expected: `"capturePath":"streaming"` inside the observability `capture` block and a `chromeMemory` object with `rendererRssPeakMb` > 0 and `samples` ≥ 1 (a 10 s render at 10 fps takes long enough for several 500 ms samples). If `.debug` is written elsewhere on this branch, `grep -n '".debug"' packages/producer/src/services/renderOrchestrator.ts` names the directory.

- [ ] **Step 8: Commit**

```bash
cd ~/src/wt/hyperframes/nle-render-spec
bunx oxfmt packages/cli/src/telemetry/renderObservability.ts packages/cli/src/telemetry/events.ts packages/cli/src/telemetry/events.test.ts packages/cli/src/commands/render.ts
bunx oxlint packages/cli/src/telemetry/renderObservability.ts packages/cli/src/telemetry/events.ts packages/cli/src/telemetry/events.test.ts packages/cli/src/commands/render.ts
/usr/bin/git add packages/cli/src/telemetry/renderObservability.ts packages/cli/src/telemetry/events.ts packages/cli/src/telemetry/events.test.ts packages/cli/src/commands/render.ts
/usr/bin/git commit -F - <<'EOF'
feat(cli): emit Chrome memory, capture path and segment fields on render events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 6: Verify in PostHog after release (no code)

After the release that contains this phase ships, run in project "Hyperframes" (356858):

```sql
SELECT
  properties.cli_version AS v,
  count() AS errors,
  countIf(properties.chrome_renderer_rss_peak_mb IS NOT NULL) AS with_chrome_mem,
  round(quantile(0.5)(toFloat(properties.chrome_renderer_rss_peak_mb))) AS p50_renderer_peak_mb,
  round(quantile(0.9)(toFloat(properties.chrome_renderer_rss_peak_mb))) AS p90_renderer_peak_mb
FROM events
WHERE event = 'render_error'
  AND timestamp >= now() - INTERVAL 7 DAY
  AND properties.error_message ILIKE '%Target closed%'
GROUP BY v
ORDER BY v DESC
LIMIT 10
```

Expected within a week: `with_chrome_mem` approaches `errors` for the new version. Record the p50/p90 in the spec's §9 root-cause item as the first data point.

---

## Self-review against the spec

- §5 Phase −1 "Chrome browser-process and renderer-process RSS sampled at a fixed cadence (peak and last sample)": Tasks 1–3.
- "GPU process's presence at failure" → recorded as `gpu_process_seen_last_sample` (spec updated to this name because presence after target loss is not measurable).
- "the capture path (streaming / disk / segmented)": Task 4 step 5 sets `capturePath`; `"segmented"` is set by Phase 2a.
- "the segment index when applicable": fields declared (Task 4, Task 5); set by Phase 2a/2c.
- §6 "Phase −1 fields on render_error / render_complete": Task 5, names match §6 exactly except `chrome_memory_samples` (added; harmless).
- Two routes (live + aggregate): Task 4 steps 4–5.
- No new dependencies; sampler cannot throw into capture; Windows covered: Task 1.
