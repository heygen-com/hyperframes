import { describe, expect, it, vi, beforeEach } from "vitest";

// CI exports HYPERFRAMES_NO_TELEMETRY=1 (and users may set DO_NOT_TRACK), which
// makes shouldTrack() short-circuit — and it caches that decision for the module's
// lifetime. Clear both BEFORE the module under test is imported / first tracks.
vi.stubEnv("HYPERFRAMES_NO_TELEMETRY", "");
vi.stubEnv("DO_NOT_TRACK", "");

// Pin config so the queue never touches disk and telemetry is enabled.
const configRead = vi.hoisted(() => ({ failOnce: false }));
vi.mock("./config.js", () => ({
  readConfig: () => {
    if (configRead.failOnce) {
      configRead.failOnce = false;
      throw new Error("EACCES");
    }
    return { anonymousId: "anon-test-123", telemetryEnabled: true };
  },
  writeConfig: () => {},
  getIdentityPersistence: () => "durable",
  getIdentityWriteOutcome: () => undefined,
}));

// shouldTrack() short-circuits in dev mode — force production behavior.
vi.mock("../utils/env.js", () => ({
  isDevMode: () => false,
}));

const dns = vi.hoisted(() => ({ answers: true, probes: 0 }));
vi.mock("../utils/hostAnswers.js", () => ({
  hostAnswers: async () => {
    dns.probes++;
    return dns.answers;
  },
}));

// Canary enrolment is registry-driven and will change as rollouts ramp; stub
// it so this asserts the WIRING (does every event carry the cohort?) rather
// than whichever canaries happen to be live today.
const canaryProps = vi.fn<() => Record<string, string>>(() => ({
  "$feature/canary-feat-x": "true",
  "$feature/canary-feat-y": "false",
}));
vi.mock("./canary.js", () => ({
  canaryEventProperties: () => canaryProps(),
}));

// Intercept the exit-time child process so flushSync delivery is assertable.
const spawnMock = vi.fn(() => ({ unref: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...(args as [])),
}));

const { trackEvent, flush, flushSync } = await import("./client.js");
const system = await import("./system.js");

type Batch = { uuid: string; event: string; properties: Record<string, unknown> }[];

function sentBatch(fetchMock: ReturnType<typeof vi.fn>, call = 0): Batch {
  const init = fetchMock.mock.calls[call]?.[1] as { body: string } | undefined;
  if (!init) throw new Error(`expected fetch call #${call} to have been made`);
  return JSON.parse(init.body).batch;
}

/** Properties of the first event in the first delivered batch. */
function eventProps(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
  if (!init) throw new Error("expected a fetch call to have been made");
  const parsed = JSON.parse(init.body) as {
    batch: Array<{ properties?: Record<string, unknown> }>;
  };
  return parsed.batch[0]?.properties ?? {};
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
    dns.probes = 0;
  });

  it("delivers harness context alongside a recognized agent without leaking marker values", async () => {
    const meta = vi.spyOn(system, "getSystemMeta").mockReturnValue({
      ...system.getSystemMeta(),
      agent_runtime: "claude_code",
      execution_harness_hint: "harbor",
    });
    try {
      const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
      vi.stubGlobal("fetch", fetchMock);
      trackEvent("cli_command", { command: "skills" });
      await flush();
      expect(eventProps(fetchMock)).toMatchObject({
        agent_runtime: "claude_code",
        execution_harness_hint: "harbor",
      });
      expect(eventProps(fetchMock)).not.toHaveProperty("HARBOR_AGENT");
    } finally {
      meta.mockRestore();
    }
  });

  it("tags every event, feedback and catalog misses included, with the launching app", async () => {
    const meta = vi.spyOn(system, "getSystemMeta").mockReturnValue({
      ...system.getSystemMeta(),
      client: "desktop/0.8.82/stable",
    });
    try {
      const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
      vi.stubGlobal("fetch", fetchMock);
      const { trackRenderFeedback, trackCatalogSearchMiss } = await import("./events.js");
      trackEvent("cli_command", { command: "lint" });
      trackRenderFeedback({ rating: 9 });
      trackCatalogSearchMiss({ query: "confetti" });
      await flush();
      expect(sentBatch(fetchMock).map((e) => [e.event, e.properties.client])).toEqual([
        ["cli_command", "desktop/0.8.82/stable"],
        ["cli_render_feedback", "desktop/0.8.82/stable"],
        ["cli_catalog_search_miss", "desktop/0.8.82/stable"],
      ]);
    } finally {
      meta.mockRestore();
    }
  });

  it("keeps events queued for the exit-time send when DNS does not answer", async () => {
    dns.answers = false;
    const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchMock);
    try {
      trackEvent("render_complete", { quality: "draft" });
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      dns.answers = true;
    }
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("sends each event once when two flushes overlap", async () => {
    const pending: Array<(r: Response) => void> = [];
    const gated = vi.fn(() => new Promise<Response>((res) => pending.push(res)));
    vi.stubGlobal("fetch", gated);

    trackEvent("render_complete", { quality: "draft" });
    const eager = flush();
    const final = flush();
    await vi.waitFor(() => expect(gated).toHaveBeenCalled());
    for (const res of pending.splice(0)) res(new Response(""));
    await Promise.all([eager, final]);
    expect(gated).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the send failed", () => {}, 1],
    ["DNS did not answer", () => (dns.answers = false), 0],
  ])("leaves the batch to the exit-time send when, ahead of it, %s", async (_, arrange, sends) => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    trackEvent("render_complete", { quality: "draft" });
    arrange();
    try {
      await Promise.all([flush(), flush()]);
    } finally {
      dns.answers = true;
    }
    // One attempt, whichever way it failed.
    expect(dns.probes).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(sends);
    // Still queued: the next send carries it.
    const succeeding = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", succeeding);
    await flush();
    expect(sentBatch(succeeding).map((e) => e.event)).toEqual(["render_complete"]);
  });

  it("still sends from a flush queued behind one that had nothing to send", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchMock);
    const empty = flush();
    trackEvent("render_complete", { quality: "draft" });
    await Promise.all([empty, flush()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the reply it never reads, so a stalled body cannot hold the process", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(body))),
    );
    trackEvent("render_complete", { quality: "draft" });
    await flush();
    expect(cancel).toHaveBeenCalled();
  });

  it("still sends from a flush queued behind one that threw", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchMock);
    trackEvent("render_complete", { quality: "draft" });
    configRead.failOnce = true;
    const first = flush();
    const second = flush();
    await expect(first).rejects.toThrow("EACCES");
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not drop events queued while a flush is in flight", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const gated = vi.fn(() => new Promise<Response>((res) => (resolveFetch = res)));
    vi.stubGlobal("fetch", gated);

    trackEvent("render_complete", { quality: "draft" });
    const inFlight = flush();
    trackEvent("cli_command_result", { command: "render" });
    await vi.waitFor(() => expect(gated).toHaveBeenCalled());
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

  it("flushSync hands the queue to a detached child that carries the payload", async () => {
    spawnMock.mockClear();
    trackEvent("render_complete", { quality: "draft" });
    flushSync();

    // The child was spawned detached with the batch inlined into its -e script.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [execPath, args, opts] = spawnMock.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(execPath).toBe(process.execPath);
    expect(args[0]).toBe("-e");
    expect(args[1]).toContain("render_complete");
    expect(args[1]).toMatch(/[0-9a-f-]{36}/); // event uuid rides along
    expect(opts).toMatchObject({ detached: true, windowsHide: true });

    // Queue handed to the child — nothing left for a regular flush.
    const fetchMock = vi.fn(() => Promise.resolve(new Response("")));
    vi.stubGlobal("fetch", fetchMock);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("canary cohort on every event", () => {
  it("attaches canary assignments as PostHog flag properties", async () => {
    canaryProps.mockReturnValue({
      "$feature/canary-feat-x": "true",
      "$feature/canary-feat-y": "false",
    });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    trackEvent("cli_command", { command: "render" });
    await flush();

    const props = eventProps(fetchMock);
    // Enrolled AND control are both emitted — absent would mean "this build
    // predates the canary", a different fact from "not enrolled".
    expect(props["$feature/canary-feat-x"]).toBe("true");
    expect(props["$feature/canary-feat-y"]).toBe("false");
  });

  it("adds no canary properties when the registry is empty", async () => {
    canaryProps.mockReturnValue({});
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    trackEvent("cli_command", { command: "render" });
    await flush();

    expect(Object.keys(eventProps(fetchMock)).some((k) => k.startsWith("$feature/canary-"))).toBe(
      false,
    );
  });
});
