// @vitest-environment happy-dom

// The render request body is the only place the browser can tell the CLI that
// this profile opted out. The CLI's own policy cannot see localStorage or
// DoNotTrack in someone else's browser, so if the body says nothing, the
// server emits render_complete / render_error anyway — attributed to the
// install id rather than the user's, which is worse than attributing it
// correctly.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyState = { allowed: true };
const mintCalls = vi.fn(() => "browser-user-123");

vi.mock("../../telemetry/policy", () => ({
  browserTelemetryAllowed: () => policyState.allowed,
}));
vi.mock("../../telemetry/config", () => ({
  getAnonymousId: () => mintCalls(),
}));
vi.mock("../../telemetry/events", () => ({
  trackStudioRenderStart: vi.fn(),
}));

const { useRenderQueue } = await import("./useRenderQueue");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

/** Body of the POST the hook makes when a render is started. */
async function startRenderBody(): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ jobId: "j1", status: "rendering" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "EventSource",
    class {
      close(): void {}
      addEventListener(): void {}
    },
  );

  let api: ReturnType<typeof useRenderQueue> | null = null;
  function Harness(): null {
    api = useRenderQueue("demo");
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(<Harness />);
  });
  await act(async () => {
    await api?.startRender({ fps: 30, quality: "standard", format: "mp4" });
  });

  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  const body = post?.[1]?.body;
  if (body === undefined || body === null) throw new Error("hook made no POST with a body");
  return JSON.parse(String(body)) as Record<string, unknown>;
}

beforeEach(() => {
  policyState.allowed = true;
  mintCalls.mockClear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("render request telemetry fields", () => {
  it("sends the browser id when this profile allows telemetry", async () => {
    const body = await startRenderBody();
    expect(body["telemetryDistinctId"]).toBe("browser-user-123");
    expect(body["telemetryOptOut"]).toBeUndefined();
  });

  it("mints no id and says so explicitly when the profile opted out", async () => {
    policyState.allowed = false;
    const body = await startRenderBody();
    // Minting is itself the leak: getAnonymousId() CREATES and persists an
    // identity, so calling it for an opted-out profile is wrong even if the
    // value were never sent.
    expect(mintCalls).not.toHaveBeenCalled();
    expect(body["telemetryDistinctId"]).toBeUndefined();
    // Omission alone would be read as an old client and fall back to the
    // install id — the flag is what actually suppresses the server event.
    expect(body["telemetryOptOut"]).toBe(true);
  });
});
