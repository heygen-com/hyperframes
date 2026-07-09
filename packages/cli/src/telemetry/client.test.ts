import { describe, expect, it, vi, beforeEach } from "vitest";

// Pin config so the queue never touches disk and telemetry is enabled.
vi.mock("./config.js", () => ({
  readConfig: () => ({ anonymousId: "anon-test-123", telemetryEnabled: true }),
  writeConfig: () => {},
}));

// shouldTrack() short-circuits in dev mode — force production behavior.
vi.mock("../utils/env.js", () => ({
  isDevMode: () => false,
}));

const { trackEvent, flush, flushSync } = await import("./client.js");

type Batch = { uuid: string; event: string }[];

function sentBatch(fetchMock: ReturnType<typeof vi.fn>, call = 0): Batch {
  const init = fetchMock.mock.calls[call]?.[1] as { body: string } | undefined;
  if (!init) throw new Error(`expected fetch call #${call} to have been made`);
  return JSON.parse(init.body).batch;
}

describe("telemetry queue delivery", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    // Drain anything a previous test left behind.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(""))),
    );
    await flush();
    vi.unstubAllGlobals();
  });

  it("forgets events only after the request completes, and stamps each with a uuid", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchMock);

    trackEvent("render_complete", { quality: "draft" });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const batch = sentBatch(fetchMock);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.event).toBe("render_complete");
    expect(batch[0]?.uuid).toMatch(/^[0-9a-f-]{36}$/);

    // Delivered — a second flush has nothing to send.
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps events queued when the request fails, and re-sends them with the SAME uuid", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("network down")));
    vi.stubGlobal("fetch", failing);

    trackEvent("render_complete", { quality: "draft" });
    await flush();
    expect(failing).toHaveBeenCalledTimes(1);

    // Queue survived the failed send — the retry carries the same event uuid,
    // so PostHog would dedupe even if the first request had actually landed.
    const succeeding = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", succeeding);
    await flush();

    expect(succeeding).toHaveBeenCalledTimes(1);
    const first = sentBatch(failing);
    const retry = sentBatch(succeeding);
    expect(retry).toHaveLength(1);
    expect(retry[0]?.uuid).toBe(first[0]?.uuid);

    await flush();
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("does not drop events queued while a flush is in flight", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const gated = vi.fn(() => new Promise<Response>((res) => (resolveFetch = res)));
    vi.stubGlobal("fetch", gated);

    trackEvent("render_complete", { quality: "draft" });
    const inFlight = flush();
    trackEvent("cli_command_result", { command: "render" });
    resolveFetch(new Response(""));
    await inFlight;

    // Only the snapshot was forgotten; the late event is still queued.
    const succeeding = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", succeeding);
    await flush();
    const batch = sentBatch(succeeding);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.event).toBe("cli_command_result");
  });

  it("flushSync drains the queue for the detached-child fallback", async () => {
    trackEvent("render_complete", { quality: "draft" });
    flushSync();

    // Queue handed to the child — nothing left for a regular flush.
    const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchMock);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
