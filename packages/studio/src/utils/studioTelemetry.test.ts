// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `studio:*` path predates telemetry/config.ts and shipped its own
// opt-out key and its own send loop, so it sat outside both contracts the
// canary work established: the documented opt-out did not silence it, and its
// events carried no cohort assignment. These pin both.

vi.mock("../telemetry/canary", () => ({
  canaryEventProperties: () => ({ "$feature/canary-test-one": "true" }),
}));

// One shared policy now governs this transport, telemetry/client.ts and
// canary enrolment. Exercised directly here so each case names the control
// under test rather than relying on ambient import.meta.env.
const policyState = { allowed: true };
vi.mock("../telemetry/policy", () => ({
  browserTelemetryAllowed: () => policyState.allowed,
}));

describe("studioTelemetry — shared opt-out and canary properties", () => {
  let trackStudioEvent: typeof import("./studioTelemetry").trackStudioEvent;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    policyState.allowed = true;
    localStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
    ({ trackStudioEvent } = await import("./studioTelemetry"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Drain the queue and return the events the batch would have sent. */
  async function sentEvents(): Promise<Array<Record<string, unknown>>> {
    await vi.runOnlyPendingTimersAsync();
    if (fetchMock.mock.calls.length === 0) return [];
    const body = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    const parsed = JSON.parse(body?.body ?? "{}") as { batch?: Array<Record<string, unknown>> };
    return parsed.batch ?? [];
  }

  // Every control the shared policy enforces — documented key, legacy key,
  // navigator.doNotTrack, VITE_HYPERFRAMES_NO_TELEMETRY, Vite dev mode, API
  // key eligibility. Before the policy was shared this transport honoured
  // only the legacy key, so all of the others still emitted `studio:*`.
  it("sends nothing when the shared policy refuses", async () => {
    policyState.allowed = false;
    trackStudioEvent("thing_happened");
    expect(await sentEvents()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches canary assignments to every event", async () => {
    trackStudioEvent("thing_happened");
    const events = await sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.["properties"]).toMatchObject({
      "$feature/canary-test-one": "true",
    });
  });

  it("lets an explicit property win over the canary mixin", async () => {
    trackStudioEvent("thing_happened", { "$feature/canary-test-one": "false" });
    const events = await sentEvents();
    expect(events[0]?.["properties"]).toMatchObject({
      "$feature/canary-test-one": "false",
    });
  });
});
