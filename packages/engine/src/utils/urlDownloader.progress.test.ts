import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  void downloadToTemp("https://cdn.example/media.mp4", tempDir()).then(
    (path) => (outcome.path = path),
    (error: unknown) => (outcome.error = error),
  );
  await waitForIo(fetchCalls(fetchMock, 1));
  return { fetchMock, outcome };
}

describe("downloadToTemp's timeout", () => {
  it("lets a sized download that sends a chunk every 100 s for 400 s finish", async () => {
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

  it("cuts a body with no Content-Length at the fixed 300 s cap even while it streams", async () => {
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
