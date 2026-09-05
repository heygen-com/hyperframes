// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCaptionSync } from "./useCaptionSync";
import { useCaptionStore } from "../store";
import { DEFAULT_ANIMATION_SET, DEFAULT_CONTAINER, DEFAULT_STYLE } from "../types";
import type { CaptionModel } from "../types";
import { resetStudioWriteTokens } from "../../utils/studioFileVersion";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeModel(styleOverride: Record<string, unknown> = {}): CaptionModel {
  return {
    width: 1920,
    height: 1080,
    duration: 5,
    groupOrder: ["g1"],
    groups: new Map([
      [
        "g1",
        {
          id: "g1",
          segmentIds: ["s1"],
          style: DEFAULT_STYLE,
          animation: DEFAULT_ANIMATION_SET,
          containerStyle: DEFAULT_CONTAINER,
        },
      ],
    ]),
    segments: new Map([
      [
        "s1",
        {
          id: "s1",
          wordId: "w0",
          text: "hi",
          start: 0,
          end: 1,
          groupIndex: 0,
          style: styleOverride,
          animation: {},
        },
      ],
    ]),
    defaultAnimation: DEFAULT_ANIMATION_SET,
  };
}

// Every mounted instance keeps its own live store subscription until
// unmounted. Tracked here so afterEach can tear them all down — otherwise a
// prior test's instance keeps reacting to later tests' store writes and
// double (or triple) fires saves against the same fetch mock.
const mountedRoots: ReturnType<typeof createRoot>[] = [];

function mountCaptionSync(projectId: string | null) {
  const captured: { sync: ReturnType<typeof useCaptionSync> | null } = { sync: null };
  function Probe() {
    captured.sync = useCaptionSync(projectId);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  mountedRoots.push(root);
  act(() => root.render(<Probe />));
  const sync = captured.sync;
  if (!sync) throw new Error("useCaptionSync did not render");
  return { sync, root };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

describe("useCaptionSync", () => {
  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => root.unmount());
    }
    resetStudioWriteTokens();
    useCaptionStore.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends If-None-Match on the first save of a new overrides file", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return jsonResponse({ ok: true, version: '"sha256:v1"' });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    mountCaptionSync("proj-1");
    const store = useCaptionStore.getState();
    store.setSourceFilePath("comp.html");
    act(() => store.setModel(makeModel()));
    act(() => store.setEditMode(true));
    act(() => store.setModel(makeModel({ x: 5 })));

    await flushDebounce();

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const headers = putCall?.[1]?.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe("*");
    expect(headers["If-Match"]).toBeUndefined();
  });

  it("sends If-Match with the version captured by loadOverrides", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return jsonResponse({ ok: true, version: '"sha256:v2"' });
      return jsonResponse({ content: "[]", version: '"sha256:v1"' });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sync } = mountCaptionSync("proj-1");
    const store = useCaptionStore.getState();
    store.setSourceFilePath("comp.html");
    // Matches useCaptionDetection's real order: setModel, then setEditMode,
    // then loadOverrides. loadOverrides setting the model again while
    // suppressSaveRef is armed relies on isEditMode already being true, or
    // that model update never gets treated as "no user edit happened".
    act(() => store.setModel(makeModel()));
    act(() => store.setEditMode(true));
    await act(async () => {
      await sync.loadOverrides();
    });

    act(() => store.setModel(makeModel({ x: 5 })));
    await flushDebounce();

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const headers = putCall?.[1]?.headers as Record<string, string>;
    expect(headers["If-Match"]).toBe('"sha256:v1"');
  });

  it("retries once with the adopted version on a 409 conflict", async () => {
    vi.useFakeTimers();
    let putAttempts = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return new Response(null, { status: 404 });
      putAttempts++;
      if (putAttempts === 1) {
        return jsonResponse(
          { error: "file conflict", currentVersion: '"sha256:fresh"', currentContent: "[]" },
          { status: 409 },
        );
      }
      expect((init.headers as Record<string, string>)["If-Match"]).toBe('"sha256:fresh"');
      return jsonResponse({ ok: true, version: '"sha256:v3"' });
    });
    vi.stubGlobal("fetch", fetchMock);

    mountCaptionSync("proj-1");
    const store = useCaptionStore.getState();
    store.setSourceFilePath("comp.html");
    act(() => store.setModel(makeModel()));
    act(() => store.setEditMode(true));
    act(() => store.setModel(makeModel({ x: 5 })));

    await flushDebounce();

    expect(putAttempts).toBe(2);
    expect(useCaptionStore.getState().syncError).toBeNull();
  });

  it("does not arm a save when edit mode activates without a prior edit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mountCaptionSync("proj-1");
    const store = useCaptionStore.getState();
    store.setSourceFilePath("comp.html");

    // Mirrors useCaptionDetection's activation order: setModel() while still
    // out of edit mode, THEN setEditMode(true) with no further model change.
    act(() => store.setModel(makeModel()));
    act(() => store.setEditMode(true));

    await flushDebounce();

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(useCaptionStore.getState().hasPendingSave).toBe(false);
  });

  it("still arms a save for a genuine edit made while already in edit mode", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return jsonResponse({ ok: true, version: '"sha256:v1"' });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    mountCaptionSync("proj-1");
    const store = useCaptionStore.getState();
    store.setSourceFilePath("comp.html");
    act(() => store.setModel(makeModel()));
    act(() => store.setEditMode(true));

    // The activation settles (see the test above); now a real edit happens.
    act(() => store.setModel(makeModel({ x: 5 })));
    expect(useCaptionStore.getState().hasPendingSave).toBe(true);

    await flushDebounce();

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
  });
  it("serializes overlapping saves so the newest body lands last", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const putBodies: string[] = [];
    const releases: Array<() => void> = [];

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return new Response(null, { status: 404 });
      putBodies.push(String(init.body));
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight--;
      return jsonResponse({ ok: true, version: `"sha256:v${putBodies.length}"` });
    });
    vi.stubGlobal("fetch", fetchMock);

    mountCaptionSync("proj-1");
    const store = useCaptionStore.getState();
    store.setSourceFilePath("comp.html");
    act(() => store.setModel(makeModel()));
    act(() => store.setEditMode(true));

    // First edit: its PUT starts and then hangs, still in flight.
    act(() => store.setModel(makeModel({ x: 5 })));
    await flushDebounce();
    expect(putBodies).toHaveLength(1);

    // A second edit arrives before the first PUT has come back. It must be
    // queued rather than raced against the in-flight one, which is what could
    // let the older body win and lose this edit.
    act(() => store.setModel(makeModel({ x: 9 })));
    await flushDebounce();
    expect(putBodies).toHaveLength(1);
    expect(maxInFlight).toBe(1);

    // Releasing the first PUT lets the queued newest body go out.
    await act(async () => {
      releases.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(putBodies).toHaveLength(2);
    expect(maxInFlight).toBe(1);
    expect(putBodies[1]).toContain('"x": 9');

    await act(async () => {
      releases.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});
