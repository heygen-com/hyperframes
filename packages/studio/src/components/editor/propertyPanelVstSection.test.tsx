// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VstSection, type VstHostApi } from "./propertyPanelVstSection";
import type { DomEditSelection } from "./domEditing";
import { parseChainFile, serializeChainFile, type ChainFileJson } from "../../utils/vstChainFile";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function makeAudioElement(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  const el = document.createElement("audio");
  return {
    element: el,
    id: "vo-1",
    selector: "#vo-1",
    label: "VO 1",
    tagName: "audio",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    textContent: "",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: false,
      canResize: false,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
    },
    ...overrides,
  } as DomEditSelection;
}

function makeVstHost(overrides: Partial<VstHostApi> = {}): VstHostApi {
  return {
    registry: [],
    scan: vi.fn(async () => {}),
    openEditor: vi.fn(),
    loadChain: vi.fn(async () => 0),
    getState: vi.fn(async () => []),
    ...overrides,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("VstSection — install hint", () => {
  it("renders an install hint and no chain controls when vstHost is null", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { host, root } = renderInto(
      <VstSection
        projectId="p1"
        element={makeAudioElement()}
        onSetAttribute={vi.fn()}
        vstHost={null}
      />,
    );
    const hint = host.querySelector('[data-vst-install-hint="true"]');
    expect(hint).not.toBeNull();
    expect(host.textContent).toContain("hyperframes-vst-host");
    expect(host.querySelector('[data-vst-add-effect="true"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("VstSection — existing chain", () => {
  it("fetches and lists plugin names from an existing chain file", async () => {
    const chain: ChainFileJson = {
      version: 1,
      plugins: [
        {
          format: "vst3",
          path: "/plugins/Reverb.vst3",
          pluginName: "Reverb",
          name: "Reverb",
          stateB64: null,
        },
        {
          format: "builtin",
          path: "builtin://eq",
          pluginName: null,
          name: "EQ",
          stateB64: null,
        },
      ],
    };
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/fx%2Fvo-1.vstchain.json")) {
        return jsonResponse({ content: serializeChainFile(chain) });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await act(async () => {
      const rendered = renderInto(
        <VstSection
          projectId="p1"
          element={makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })}
          onSetAttribute={vi.fn()}
          vstHost={makeVstHost()}
        />,
      );
      await flushAsyncWork();
      return rendered;
    });

    expect(host.textContent).toContain("Reverb");
    expect(host.textContent).toContain("EQ");
    expect(host.querySelectorAll('[data-vst-plugin-row="true"]')).toHaveLength(2);
    act(() => root.unmount());
  });
});

describe("VstSection — add effect", () => {
  it("writes a new chain file via PUT and commits the vst-chain attribute", async () => {
    const onSetAttribute = vi.fn();
    const fetchMock = vi.fn(async (input, init): Promise<Response> => {
      const url = requestUrl(input);
      if (
        url.includes("/api/projects/p1/files/fx%2Fvo-1.vstchain.json") &&
        init?.method === "PUT"
      ) {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const vstHost = makeVstHost({
      registry: [{ path: "/plugins/Reverb.vst3", name: "Reverb", format: "vst3" }],
    });

    const { host, root } = renderInto(
      <VstSection
        projectId="p1"
        element={makeAudioElement()}
        onSetAttribute={onSetAttribute}
        vstHost={vstHost}
      />,
    );

    const addButton = host.querySelector<HTMLButtonElement>('[data-vst-add-effect="true"]');
    expect(addButton).not.toBeNull();

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(requestUrl(putCall?.[0] as Parameters<typeof fetch>[0])).toContain(
      "fx%2Fvo-1.vstchain.json",
    );
    expect(onSetAttribute).toHaveBeenCalledWith("vst-chain", "fx/vo-1.vstchain.json");
    act(() => root.unmount());
  });

  it("scans the registry first when it's empty", async () => {
    const onSetAttribute = vi.fn();
    const fetchMock = vi.fn(async (): Promise<Response> => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const registry = [{ path: "/plugins/Reverb.vst3", name: "Reverb", format: "vst3" }];
    const scan = vi.fn(async () => {
      vstHost.registry = registry;
    });
    const vstHost = makeVstHost({ registry: [], scan });

    const { host, root } = renderInto(
      <VstSection
        projectId="p1"
        element={makeAudioElement()}
        onSetAttribute={onSetAttribute}
        vstHost={vstHost}
      />,
    );

    const addButton = host.querySelector<HTMLButtonElement>('[data-vst-add-effect="true"]');
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(scan).toHaveBeenCalledTimes(1);
    expect(onSetAttribute).toHaveBeenCalledWith("vst-chain", "fx/vo-1.vstchain.json");
    act(() => root.unmount());
  });
});

// ── Finding 1: native-editor state persistence (polling) ──────────────────
//
// A native plugin editor window has no "closed" event on the wire (see
// propertyPanelVstSection.tsx's doc-comment on VST_STATE_POLL_INTERVAL_MS) —
// edits only ever land in the sidecar's live in-memory plugin instance. This
// section polls `getState` after "Open editor" is clicked and persists any
// diff to the chain file so render doesn't silently diverge from preview.

describe("VstSection — native-editor state persistence", () => {
  const existingChain: ChainFileJson = {
    version: 1,
    plugins: [
      {
        format: "vst3",
        path: "/plugins/Reverb.vst3",
        pluginName: "Reverb",
        name: "Reverb",
        stateB64: "AAAA",
      },
    ],
  };

  function stubReadOnly(): ReturnType<typeof vi.fn> {
    return vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/fx%2Fvo-1.vstchain.json")) {
        return jsonResponse({ content: serializeChainFile(existingChain) });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls getState after 'Open editor' and PUTs the chain file when state changed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/fx%2Fvo-1.vstchain.json")) {
        if (init?.method === "PUT") return jsonResponse({ ok: true });
        return jsonResponse({ content: serializeChainFile(existingChain) });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const getState = vi.fn(async () => ["NEW_STATE_B64"]);
    const vstHost = makeVstHost({ getState });

    const { host, root } = await act(async () => {
      const rendered = renderInto(
        <VstSection
          projectId="p1"
          element={makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })}
          onSetAttribute={vi.fn()}
          vstHost={vstHost}
        />,
      );
      await flushAsyncWork();
      return rendered;
    });

    const openButton = host.querySelector<HTMLButtonElement>('[data-vst-open-editor="true"]');
    expect(openButton).not.toBeNull();
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(vstHost.openEditor).toHaveBeenCalledWith("vo-1", 0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
      await flushAsyncWork();
    });

    expect(getState).toHaveBeenCalledWith("vo-1");
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const body = putCall?.[1]?.body;
    if (typeof body !== "string") throw new Error("expected a string PUT body");
    const written = parseChainFile(body);
    expect(written?.plugins[0]?.stateB64).toBe("NEW_STATE_B64");

    act(() => root.unmount());
  });

  it("stamps domEditSaveTimestampRef after a poll-triggered PUT (suppresses the studio's own file-change reload)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/fx%2Fvo-1.vstchain.json")) {
        if (init?.method === "PUT") return jsonResponse({ ok: true });
        return jsonResponse({ content: serializeChainFile(existingChain) });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const getState = vi.fn(async () => ["NEW_STATE_B64"]);
    const vstHost = makeVstHost({ getState });
    const domEditSaveTimestampRef = { current: 0 };

    const { host, root } = await act(async () => {
      const rendered = renderInto(
        <VstSection
          projectId="p1"
          element={makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })}
          onSetAttribute={vi.fn()}
          vstHost={vstHost}
          domEditSaveTimestampRef={domEditSaveTimestampRef}
        />,
      );
      await flushAsyncWork();
      return rendered;
    });

    const openButton = host.querySelector<HTMLButtonElement>('[data-vst-open-editor="true"]');
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(domEditSaveTimestampRef.current).toBe(0);

    const beforePoll = Date.now();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
      await flushAsyncWork();
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    // The ref must be stamped to "now" (not left at its initial 0) exactly
    // when a real write happens, so the studio's file-watcher (which reloads
    // the preview iframe unless Date.now() - domEditSaveTimestampRef.current
    // < 4000) treats this as our own save and skips reloading.
    expect(domEditSaveTimestampRef.current).toBeGreaterThanOrEqual(beforePoll);

    act(() => root.unmount());
  });

  it("does not PUT when getState reports no change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const fetchMock = stubReadOnly();
    vi.stubGlobal("fetch", fetchMock);

    const getState = vi.fn(async () => ["AAAA"]); // matches existingChain's stateB64 already
    const vstHost = makeVstHost({ getState });

    const { host, root } = await act(async () => {
      const rendered = renderInto(
        <VstSection
          projectId="p1"
          element={makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })}
          onSetAttribute={vi.fn()}
          vstHost={vstHost}
        />,
      );
      await flushAsyncWork();
      return rendered;
    });

    const openButton = host.querySelector<HTMLButtonElement>('[data-vst-open-editor="true"]');
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
      await vi.advanceTimersByTimeAsync(2500);
      await flushAsyncWork();
    });

    expect(getState).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);

    act(() => root.unmount());
  });

  it("stops polling on unmount (no further PUT after unmount + timer advance)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/fx%2Fvo-1.vstchain.json")) {
        if (init?.method === "PUT") return jsonResponse({ ok: true });
        return jsonResponse({ content: serializeChainFile(existingChain) });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const getState = vi.fn(async () => ["NEW_STATE_B64"]);
    const vstHost = makeVstHost({ getState });

    const { host, root } = await act(async () => {
      const rendered = renderInto(
        <VstSection
          projectId="p1"
          element={makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })}
          onSetAttribute={vi.fn()}
          vstHost={vstHost}
        />,
      );
      await flushAsyncWork();
      return rendered;
    });

    const openButton = host.querySelector<HTMLButtonElement>('[data-vst-open-editor="true"]');
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    // Unmount immediately — this fires the "best effort" flush once (one PUT
    // from the cleanup-triggered flush is expected), but no MORE polling
    // ticks should follow.
    await act(async () => {
      root.unmount();
      await flushAsyncWork();
    });

    const putCallsAfterUnmount = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    ).length;
    fetchMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
      await flushAsyncWork();
    });

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    // Sanity: the flush-on-unmount path itself is allowed to have PUT at
    // most once (the one best-effort save), never more.
    expect(putCallsAfterUnmount).toBeLessThanOrEqual(1);
  });
});
