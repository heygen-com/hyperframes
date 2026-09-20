// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { useServerConnection } from "./useServerConnection";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const captured: { projectId: string | null } = { projectId: null };

function Probe() {
  captured.projectId = useServerConnection().projectId;
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The hash project id outlives the project it names — a renamed folder, or a
 * bookmark from a project that is gone. It used to be trusted unconditionally,
 * so every later /api/projects/<id>/... request 404'd for the life of the tab,
 * including the composition read that opens the SDK session. Telemetry after
 * the read-reason split: 120 http_error/404 reads across 5 users in 24h.
 */
function stubFetch(projectRoute: { status: number } | "reject") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/projects") {
        return { ok: true, json: async () => ({ projects: [{ id: "real-project" }] }) } as Response;
      }
      if (projectRoute === "reject") throw new TypeError("Failed to fetch");
      return { ok: projectRoute.status === 200, status: projectRoute.status } as Response;
    }),
  );
}

async function renderWithHash(hash: string) {
  window.location.hash = hash;
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await flush();
  return root;
}

describe("useServerConnection hash project id", () => {
  beforeEach(() => {
    captured.projectId = null;
    window.location.hash = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(trackStudioEvent).mockClear();
  });

  it("keeps a hash id the server can resolve", async () => {
    stubFetch({ status: 200 });
    const root = await renderWithHash("#project/stale-or-not");

    expect(captured.projectId).toBe("stale-or-not");
    await act(async () => root.unmount());
  });

  it("falls back to the first project when the hash id is gone", async () => {
    stubFetch({ status: 404 });
    const root = await renderWithHash("#project/deleted-project");

    expect(captured.projectId).toBe("real-project");
    expect(window.location.hash).toContain("real-project");
    await act(async () => root.unmount());
  });

  // The important one: a blip must not rewrite the user's hash out from under a
  // project that is actually fine. Only a definite 404 is "missing".
  it("keeps the hash id when the check itself fails", async () => {
    stubFetch("reject");
    const root = await renderWithHash("#project/unreachable-check");

    expect(captured.projectId).toBe("unreachable-check");
    await act(async () => root.unmount());
  });

  it("keeps the hash id on a non-404 error status", async () => {
    stubFetch({ status: 500 });
    const root = await renderWithHash("#project/server-erroring");

    expect(captured.projectId).toBe("server-erroring");
    await act(async () => root.unmount());
  });
});

/**
 * The verdict event. Until it existed, a tab that kept its hash because the
 * check itself failed was indistinguishable in production from one that never
 * ran the check — different causes, different fixes, one silent bucket.
 */
describe("project_hash_validated", () => {
  const verdictCalls = () =>
    vi.mocked(trackStudioEvent).mock.calls.filter(([name]) => name === "project_hash_validated");

  beforeEach(() => {
    captured.projectId = null;
    window.location.hash = "";
    vi.mocked(trackStudioEvent).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an ok verdict with its status", async () => {
    stubFetch({ status: 200 });
    const root = await renderWithHash("#project/stale-or-not");
    expect(verdictCalls()).toEqual([
      ["project_hash_validated", { stage: "mount", outcome: "ok", status: 200 }],
    ]);
    await act(async () => root.unmount());
  });

  it("reports a missing verdict with the 404", async () => {
    stubFetch({ status: 404 });
    const root = await renderWithHash("#project/deleted-project");
    expect(verdictCalls()).toEqual([
      ["project_hash_validated", { stage: "mount", outcome: "missing", status: 404 }],
    ]);
    await act(async () => root.unmount());
  });

  it("reports unknown with no status when the check is rejected", async () => {
    // The point of the event: this case LOOKS like success from outside (the
    // hash is kept) but is a failed check. Only the verdict says so.
    stubFetch("reject");
    const root = await renderWithHash("#project/unreachable-check");
    expect(verdictCalls()).toEqual([
      ["project_hash_validated", { stage: "mount", outcome: "unknown" }],
    ]);
    await act(async () => root.unmount());
  });

  it("reports unknown — not missing — for a 5xx", async () => {
    stubFetch({ status: 500 });
    const root = await renderWithHash("#project/server-erroring");
    expect(verdictCalls()).toEqual([
      ["project_hash_validated", { stage: "mount", outcome: "unknown", status: 500 }],
    ]);
    await act(async () => root.unmount());
  });

  it("emits nothing when there is no hash id to validate", async () => {
    stubFetch({ status: 200 });
    const root = await renderWithHash("");
    expect(verdictCalls()).toEqual([]);
    await act(async () => root.unmount());
  });
});
