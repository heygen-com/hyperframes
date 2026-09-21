// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openComposition = vi.fn();

vi.mock("@hyperframes/sdk", () => ({
  openComposition: (...args: unknown[]) => openComposition(...args),
}));

import type { Composition } from "@hyperframes/sdk";
import { useSdkSession, type SdkSessionHandle } from "./useSdkSession";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

import { trackStudioEvent } from "../utils/studioTelemetry";

const trackMock = vi.mocked(trackStudioEvent);

function Probe({ projectId }: { projectId: string }) {
  useSdkSession(projectId, "index.html");
  return null;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeSession(): Composition {
  return { dispose: vi.fn() } as unknown as Composition;
}

function response(content: string): Response {
  return { ok: true, json: async () => ({ content }) } as Response;
}

async function flushAsyncEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useSdkSession ownership", () => {
  beforeEach(() => {
    openComposition.mockReset();
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides project A immediately while project B with the same path is still opening", async () => {
    const sessionA = fakeSession();
    const publishedA = fakeSession();
    const sessionB = fakeSession();
    let resolveProjectB: ((value: Response) => void) | undefined;
    const projectBResponse = new Promise<Response>((resolve) => {
      resolveProjectB = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("project-b") ? projectBResponse : Promise.resolve(response("PROJECT_A")),
      ),
    );
    openComposition.mockImplementation(async (content: string) =>
      content === "PROJECT_A" ? sessionA : sessionB,
    );

    const captured: { handle: SdkSessionHandle | null } = { handle: null };
    function Probe({ projectId }: { projectId: string }) {
      captured.handle = useSdkSession(projectId, "index.html");
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();
    expect(captured.handle?.session).toBe(sessionA);

    let publication: ReturnType<SdkSessionHandle["publish"]> | undefined;
    await act(async () => {
      publication = captured.handle?.publish({
        candidate: publishedA,
        expectedSession: sessionA,
        targetPath: "index.html",
      });
    });
    expect(publication).toBe("published");
    expect(captured.handle?.session).toBe(publishedA);

    await act(async () => root.render(<Probe projectId="project-b" />));
    expect(captured.handle?.session).toBeNull();
    expect(publishedA.dispose).toHaveBeenCalledOnce();
    expect(
      captured.handle?.publish({
        candidate: fakeSession(),
        expectedSession: publishedA,
        targetPath: "index.html",
      }),
    ).toBe("rejected-inactive-target");

    resolveProjectB?.(response("PROJECT_B"));
    await flushAsyncEffects();
    expect(captured.handle?.session).toBe(sessionB);

    await act(async () => root.unmount());
    expect(sessionB.dispose).toHaveBeenCalledOnce();
  });

  it("disposes the currently published candidate when its owner unmounts", async () => {
    const opened = fakeSession();
    const published = fakeSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    openComposition.mockResolvedValue(opened);

    const captured: { handle: SdkSessionHandle | null } = { handle: null };
    function Probe() {
      captured.handle = useSdkSession("project-a", "index.html");
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await flushAsyncEffects();
    expect(captured.handle?.session).toBe(opened);
    let publication: ReturnType<SdkSessionHandle["publish"]> | undefined;
    await act(async () => {
      publication = captured.handle?.publish({
        candidate: published,
        expectedSession: opened,
        targetPath: "index.html",
      });
    });
    expect(publication).toBe("published");
    expect(opened.dispose).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(published.dispose).toHaveBeenCalledOnce();
  });
});

describe("useSdkSession unreachable project", () => {
  beforeEach(() => {
    openComposition.mockReset();
    trackMock.mockClear();
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function probeHandle(projectId: string) {
    const captured: { handle: SdkSessionHandle | null } = { handle: null };
    function HandleProbe() {
      captured.handle = useSdkSession(projectId, "index.html");
      return null;
    }
    return { captured, HandleProbe };
  }

  const failedRead = (status: number) => async () =>
    ({ ok: false, status, json: async () => ({}) }) as Response;

  /** Render the hook for `projectId` against a stubbed read and let it settle. */
  async function readOutcome(
    projectId: string,
    read: () => Promise<Response>,
  ): Promise<{ captured: { handle: SdkSessionHandle | null }; unmount: () => Promise<void> }> {
    vi.stubGlobal("fetch", vi.fn(read));
    const { captured, HandleProbe } = probeHandle(projectId);
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<HandleProbe />));
    await flushAsyncEffects();
    return { captured, unmount: () => act(async () => root.unmount()) };
  }

  // A 404 on the composition read is the one failure that says something about
  // the PROJECT rather than the request: under the CLI host it means this
  // Studio serves a different one. Every edit then fails silently, so the UI
  // needs the id to explain that.
  it("names the project when the read is a 404", async () => {
    const { captured, unmount } = await readOutcome("gone-project", failedRead(404));

    expect(captured.handle?.unreachableProject).toBe("gone-project");
    await unmount();
  });

  // A 500 says the request failed, not that the project is elsewhere. Claiming
  // otherwise would tell a user their tab is pointed at the wrong project when
  // the server is merely unwell.
  it("stays quiet on a failure that says nothing about the project", async () => {
    const { captured, unmount } = await readOutcome("project-a", failedRead(500));

    expect(captured.handle?.unreachableProject).toBeNull();
    await unmount();
  });

  it("clears the state once the project resolves", async () => {
    const { captured, unmount } = await readOutcome("gone-project", failedRead(404));
    expect(captured.handle?.unreachableProject).toBe("gone-project");

    openComposition.mockResolvedValue(fakeSession());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    await act(async () => {
      captured.handle?.forceReload();
    });
    await flushAsyncEffects();

    expect(captured.handle?.unreachableProject).toBeNull();
    await unmount();
  });
});

describe("useSdkSession unavailable telemetry", () => {
  beforeEach(() => {
    openComposition.mockReset();
    trackMock.mockClear();
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Every cutover chokepoint silently takes the server path when there is no
  // session, and the shadow never runs either — so a missing session is a total,
  // otherwise-invisible SDK bypass. These exits are its only origin.
  //
  // `stage: read` carries a reason because it was the largest remaining class
  // and a single opaque string: 56 users hit it in a 7-day window and never
  // landed one successful SDK edit between them, with no way to tell a genuinely
  // absent file from a request that never reached one.
  it("reports the HTTP status when the read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(trackMock).toHaveBeenCalledWith("sdk_session_unavailable", {
      stage: "read",
      reason: "http_error",
      status: 404,
    });
    await act(async () => root.unmount());
  });

  it("separates an unexpected response shape from a failed request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(trackMock).toHaveBeenCalledWith("sdk_session_unavailable", {
      stage: "read",
      reason: "missing_content",
    });
    await act(async () => root.unmount());
  });

  // `optional=1` answers a file that is not on disk with 200 + an empty string,
  // so this is what "the composition genuinely is not there" looks like on the
  // wire — previously indistinguishable from a broken request. The shim and a
  // real 0-byte file are the same response, hence the name.
  it("separates a file that is not on disk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ content: "" }) }) as Response),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(trackMock).toHaveBeenCalledWith("sdk_session_unavailable", {
      stage: "read",
      reason: "absent_or_empty",
    });
    await act(async () => root.unmount());
  });

  it("reports a parse failure with its message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    openComposition.mockRejectedValue(new Error("unparseable composition"));

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(trackMock).toHaveBeenCalledWith("sdk_session_unavailable", {
      stage: "open",
      error: "unparseable composition",
    });
    await act(async () => root.unmount());
  });

  it("stays silent on the happy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("PROJECT_A")),
    );
    openComposition.mockResolvedValue(fakeSession());

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();

    expect(trackMock).not.toHaveBeenCalledWith("sdk_session_unavailable", expect.anything());
    await act(async () => root.unmount());
  });
});
