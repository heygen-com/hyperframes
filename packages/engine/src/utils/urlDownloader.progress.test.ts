import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setDownloadFetchForTests, downloadToTemp } from "./urlDownloader.js";

const stubFetch = (replacement: unknown): void =>
  _setDownloadFetchForTests(replacement as Parameters<typeof _setDownloadFetchForTests>[0]);

const dirs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  _setDownloadFetchForTests();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-url-progress-"));
  dirs.push(dir);
  return dir;
}

/**
 * A body that sends one of `chunks` every `everyMs`, then ends, repeats them forever, or hangs.
 * With no chunks it never sends. `contentLength` is declared when given.
 */
function trickle(
  chunks: string[],
  everyMs: number,
  {
    contentLength,
    then = "end",
  }: { contentLength?: number; then?: "end" | "repeat" | "hang" } = {},
): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = 0;
      const sendNext = (): void => {
        timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(chunks[sent % chunks.length]));
          sent += 1;
          if (sent < chunks.length || then === "repeat") sendNext();
          else if (then === "end") controller.close();
        }, everyMs);
      };
      if (chunks.length > 0) sendNext();
    },
    cancel() {
      clearTimeout(timer);
    },
  });
  const headers =
    contentLength === undefined ? undefined : { "content-length": `${contentLength}` };
  return new Response(body, { headers });
}

/**
 * A sized body that sends `chunk` `everyMs` after each read, `count` times. Waiting for
 * `readerWaiting()` before advancing the clock keeps real disk writes from lagging fake time.
 */
function pacedBody(chunk: Uint8Array, count: number, everyMs: number) {
  let sent = 0;
  let waiting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        waiting = true;
        return new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            waiting = false;
            controller.enqueue(chunk);
            sent += 1;
            if (sent === count) controller.close();
            resolve();
          }, everyMs);
        });
      },
      cancel() {
        clearTimeout(timer);
      },
    },
    { highWaterMark: 0 },
  );
  const response = new Response(body, {
    headers: { "content-length": `${chunk.length * count}` },
  });
  return {
    response,
    readerWaiting: () => waiting || sent === count,
    finished: () => sent === count,
  };
}

/** Like `waitForIo`, but bounded by real time so a loaded disk cannot fall behind the fake clock. */
async function waitForRealIo(done: () => boolean, budgetMs = 10_000): Promise<void> {
  const deadline = performance.now() + budgetMs;
  while (!done() && performance.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Real I/O (cache lock, file writes) settles on the real event loop; the fake clock stays put. */
async function waitForIo(done: () => boolean, turns = 100_000): Promise<void> {
  for (let i = 0; i < turns && !done(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function advanceSeconds(seconds: number): Promise<void> {
  for (let s = 0; s < seconds; s += 1) {
    await vi.advanceTimersByTimeAsync(1_000);
    await waitForIo(() => false, 20);
  }
}

const fetchCalls = (fetchMock: { mock: { calls: unknown[] } }, count: number) => () =>
  fetchMock.mock.calls.length >= count;

/** Starts a download whose every attempt gets a fresh `response()`, once the first fetch is made. */
async function startDownload(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  stubFetch(fetchMock);
  const outcome: { path?: string; error?: unknown } = {};
  const dir = tempDir();
  void downloadToTemp("https://cdn.example/media.mp4", dir).then(
    (path) => (outcome.path = path),
    (error: unknown) => (outcome.error = error),
  );
  await waitForIo(fetchCalls(fetchMock, 1));
  return { fetchMock, outcome, dir };
}

const disableThroughputFloor = (): void =>
  vi.stubEnv("HYPERFRAMES_MIN_DOWNLOAD_BYTES_PER_SEC", "0");

const tooSlow = {
  kind: "timeout",
  retryable: true,
  message: "Download too slow: under 32768 bytes/s over the last 60s",
};

describe("downloadToTemp's timeout", () => {
  it("cuts a sized download that sends a chunk every 100 s at the throughput floor", async () => {
    const chunks = ["chunk-1 ", "chunk-2 ", "chunk-3 ", "chunk-4"];
    const { fetchMock, outcome, dir } = await startDownload(() =>
      trickle(chunks, 100_000, { contentLength: chunks.join("").length }),
    );
    await advanceSeconds(159);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advanceSeconds(1);
    await waitForIo(fetchCalls(fetchMock, 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advanceSeconds(160);
    await waitForIo(() => "error" in outcome);

    expect(outcome.error).toMatchObject(tooSlow);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("lets the same 100 s trickle finish when the floor is disabled with 0", async () => {
    disableThroughputFloor();
    const chunks = ["chunk-1 ", "chunk-2 ", "chunk-3 ", "chunk-4"];
    const { fetchMock, outcome } = await startDownload(() =>
      trickle(chunks, 100_000, { contentLength: chunks.join("").length }),
    );
    await advanceSeconds(400);
    await waitForIo(() => "path" in outcome || "error" in outcome);

    expect(outcome.error).toBeUndefined();
    expect(readFileSync(outcome.path!, "utf8")).toBe(chunks.join(""));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cuts a 1 KiB/s trickle that declares a huge Content-Length and removes the partial", async () => {
    vi.stubEnv("HYPERFRAMES_DOWNLOAD_MIN_FREE_BYTES", "0");
    const { fetchMock, outcome, dir } = await startDownload(() =>
      trickle(["x".repeat(1024)], 1_000, { contentLength: 6 * 1024 ** 3, then: "repeat" }),
    );
    await advanceSeconds(60);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advanceSeconds(1);
    await waitForIo(fetchCalls(fetchMock, 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advanceSeconds(61);
    await waitForIo(() => "error" in outcome);

    expect(outcome.error).toMatchObject(tooSlow);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("lets a steady sized download above the floor run past 15 minutes", async () => {
    const chunk = new Uint8Array(40 * 1024).fill(0x78);
    const seconds = 15 * 60 + 20;
    const paced = pacedBody(chunk, seconds, 1_000);
    const startedAt = Date.now();
    const { fetchMock, outcome } = await startDownload(() => paced.response);
    while (!paced.finished() && !("error" in outcome)) {
      await waitForRealIo(paced.readerWaiting);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await waitForRealIo(() => "path" in outcome || "error" in outcome);

    expect(outcome.error).toBeUndefined();
    expect(Date.now() - startedAt).toBeGreaterThan(15 * 60_000);
    expect(statSync(outcome.path!).size).toBe(chunk.length * seconds);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 120_000);

  it("stops a steady sized download above the floor at the absolute deadline without retrying", async () => {
    vi.stubEnv("HYPERFRAMES_MAX_DOWNLOAD_MS", "120000");
    const chunk = new Uint8Array(40 * 1024).fill(0x78);
    const paced = pacedBody(chunk, 10_000, 1_000);
    const { fetchMock, outcome, dir } = await startDownload(() => paced.response);
    for (let s = 0; s < 200 && !("error" in outcome); s += 1) {
      await waitForRealIo(paced.readerWaiting);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await waitForRealIo(() => "error" in outcome);

    expect(outcome.error).toMatchObject({
      kind: "timeout",
      retryable: false,
      message: "Download exceeded the 120s time limit",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual([]);
  }, 60_000);

  it("cuts a body with no Content-Length at the fixed 300 s cap even while it streams", async () => {
    disableThroughputFloor();
    const { fetchMock, outcome } = await startDownload(() =>
      trickle(["tick "], 10_000, { then: "repeat" }),
    );
    await advanceSeconds(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advanceSeconds(1);
    await waitForIo(fetchCalls(fetchMock, 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advanceSeconds(300);
    await waitForIo(() => "error" in outcome);

    expect(outcome.error).toMatchObject({
      kind: "timeout",
      retryable: true,
      message: "Download timeout after 300s",
    });
  });

  it("fails a silent body after 300 s, retries once, and fails with today's error", async () => {
    const { fetchMock, outcome } = await startDownload(() => trickle([], 0));
    await advanceSeconds(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advanceSeconds(1);
    await waitForIo(fetchCalls(fetchMock, 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advanceSeconds(300);
    await waitForIo(() => "error" in outcome);

    expect(outcome.error).toMatchObject({
      kind: "timeout",
      retryable: true,
      message: "Download timeout after 300s",
    });
  });

  it("fails a sized body 300 s after its last chunk and says it stalled", async () => {
    disableThroughputFloor();
    const { fetchMock, outcome } = await startDownload(() =>
      trickle(["part-1 "], 100_000, { contentLength: 1_000, then: "hang" }),
    );
    await advanceSeconds(399);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advanceSeconds(1);
    await waitForIo(fetchCalls(fetchMock, 2));
    await advanceSeconds(400);
    await waitForIo(() => "error" in outcome);

    expect(outcome.error).toMatchObject({
      kind: "timeout",
      retryable: true,
      message: "Download stalled: no data for 300s",
    });
  });
});
