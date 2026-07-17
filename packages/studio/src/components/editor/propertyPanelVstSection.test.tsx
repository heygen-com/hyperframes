// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VstSection, type VstHostApi } from "./propertyPanelVstSection";
import type { DomEditSelection } from "./domEditing";
import {
  parseChainFile,
  serializeChainFile,
  type CarveBand,
  type ChainFileJson,
} from "../../utils/vstChainFile";
import { usePlayerStore } from "../../player/store/playerStore";
import { renderInto, setupReactActEnvironment } from "./testRenderUtils";

setupReactActEnvironment();

afterEach(() => {
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
    setParam: vi.fn(),
    loadChain: vi.fn(async () => ({ trackIndex: 0, sampleRate: 48000, stable: true })),
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

/** Picks option index `i` in the "Add effect" <select> and fires React's onChange. */
async function selectAddOption(host: HTMLElement, i: number): Promise<void> {
  const select = host.querySelector<HTMLSelectElement>('[data-vst-add-effect="true"]');
  expect(select).not.toBeNull();
  if (!select) return;
  await act(async () => {
    select.value = String(i);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsyncWork();
  });
}

/** Renders `<VstSection>` against the standard `vo-1` element (with an
 *  existing `fx/vo-1.vstchain.json` chain unless `overrides.element` picks a
 *  different one), flushes its mount-time async work, and returns the
 *  rendered host/root — the shared render shape most tests below need. */
async function renderVstSectionAsync(
  vstHost: VstHostApi,
  overrides: {
    element?: DomEditSelection;
    onSetAttribute?: (attr: string, value: string) => void | Promise<void>;
    domEditSaveTimestampRef?: { current: number };
  } = {},
): Promise<ReturnType<typeof renderInto>> {
  return act(async () => {
    const rendered = renderInto(
      <VstSection
        projectId="p1"
        element={
          overrides.element ??
          makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })
        }
        onSetAttribute={overrides.onSetAttribute ?? vi.fn()}
        vstHost={vstHost}
        domEditSaveTimestampRef={overrides.domEditSaveTimestampRef}
      />,
    );
    await flushAsyncWork();
    return rendered;
  });
}

/** Renders `<VstSection>` against a fresh (no existing chain) `vo-1` element
 *  — used by the "add effect" tests, which then flush the picker-population
 *  effect separately (its scan/registry-population timing is itself under
 *  test in some of these). */
async function renderVstSectionForAdd(
  vstHost: VstHostApi,
  onSetAttribute: (attr: string, value: string) => void | Promise<void>,
): Promise<ReturnType<typeof renderInto>> {
  const rendered = renderInto(
    <VstSection
      projectId="p1"
      element={makeAudioElement()}
      onSetAttribute={onSetAttribute}
      vstHost={vstHost}
    />,
  );
  await act(async () => {
    await flushAsyncWork();
  });
  return rendered;
}

/** Stubs `fetch` to resolve `chain` for a GET on the standard `vo-1` chain
 *  file URL, and throw for anything else — the shared read-only mock several
 *  describe blocks below need. */
function stubChainFileGet(chain: ChainFileJson): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes("fx%2Fvo-1.vstchain.json")) {
      return jsonResponse({ content: serializeChainFile(chain) });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

/** Stubs `fetch` to serve `chain` on GET and capture the PUT body (via the
 *  returned `written()` accessor) on PUT — the standard "load then re-save"
 *  mock several tests below need. */
function stubChainFilePutCapture(chain: ChainFileJson): {
  fetchMock: ReturnType<typeof vi.fn>;
  written: () => ChainFileJson | null;
} {
  let putBody: string | null = null;
  const fetchMock = vi.fn(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/files/fx%2Fvo-1.vstchain.json") && init?.method === "PUT") {
        putBody = String(init.body);
        return jsonResponse({ ok: true });
      }
      if (url.includes("/files/fx%2Fvo-1.vstchain.json")) {
        return jsonResponse({ content: serializeChainFile(chain) });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method}`);
    },
  );
  return { fetchMock, written: () => JSON.parse(putBody ?? "null") as ChainFileJson | null };
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

describe("VstSection — bypass toggles", () => {
  function bypassHarness(chain: ChainFileJson) {
    const { fetchMock, written } = stubChainFilePutCapture(chain);
    vi.stubGlobal("fetch", fetchMock);
    const rendered = renderInto(
      <VstSection
        projectId="p1"
        element={makeAudioElement({ dataAttributes: { "vst-chain": "fx/vo-1.vstchain.json" } })}
        onSetAttribute={vi.fn()}
        vstHost={makeVstHost()}
      />,
    );
    return { ...rendered, written };
  }

  const twoPlugins: ChainFileJson = {
    version: 1,
    plugins: [
      { format: "builtin", path: "Reverb", pluginName: null, name: "Reverb", stateB64: null },
      { format: "builtin", path: "Delay", pluginName: null, name: "Delay", stateB64: null },
    ],
  };

  it("Disable on a row writes enabled:false for that plugin only", async () => {
    const { host, root, written } = bypassHarness(twoPlugins);
    await act(async () => {
      await flushAsyncWork();
    });

    const toggles = host.querySelectorAll<HTMLButtonElement>('[data-vst-toggle-plugin="true"]');
    expect(toggles).toHaveLength(2);
    expect(toggles[0]?.textContent).toBe("Disable");

    await act(async () => {
      toggles[1]?.click();
      await flushAsyncWork();
    });

    const chain = written();
    expect(chain?.plugins.map((p) => p.enabled)).toEqual([undefined, false]);
    act(() => root.unmount());
  });

  it("Disable all writes enabled:false for every plugin; Enable all flips back", async () => {
    const { host, root, written } = bypassHarness(twoPlugins);
    await act(async () => {
      await flushAsyncWork();
    });

    const all = host.querySelector<HTMLButtonElement>('[data-vst-toggle-all="true"]');
    expect(all?.textContent).toBe("Disable all");
    await act(async () => {
      all?.click();
      await flushAsyncWork();
    });
    expect(written()?.plugins.every((p) => p.enabled === false)).toBe(true);

    // The panel state now reflects the all-disabled chain — the same button
    // reads "Enable all" and flips everything back on.
    const allAfter = host.querySelector<HTMLButtonElement>('[data-vst-toggle-all="true"]');
    expect(allAfter?.textContent).toBe("Enable all");
    await act(async () => {
      allAfter?.click();
      await flushAsyncWork();
    });
    expect(written()?.plugins.every((p) => p.enabled === true)).toBe(true);
    act(() => root.unmount());
  });

  it("a disabled plugin's row is dimmed and labeled (off)", async () => {
    const disabledChain: ChainFileJson = {
      version: 1,
      plugins: [
        {
          format: "builtin",
          path: "Reverb",
          pluginName: null,
          name: "Reverb",
          stateB64: null,
          enabled: false,
        },
      ],
    };
    const { host, root } = bypassHarness(disabledChain);
    await act(async () => {
      await flushAsyncWork();
    });

    const row = host.querySelector('[data-vst-plugin-row="true"]');
    expect(row?.className).toContain("opacity-50");
    expect(row?.textContent).toContain("(off)");
    expect(host.querySelector('[data-vst-toggle-plugin="true"]')?.textContent).toBe("Enable");
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
    const fetchMock = stubChainFileGet(chain);
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await renderVstSectionAsync(makeVstHost());

    expect(host.textContent).toContain("Reverb");
    expect(host.textContent).toContain("EQ");
    expect(host.querySelectorAll('[data-vst-plugin-row="true"]')).toHaveLength(2);
    act(() => root.unmount());
  });

  it("offers Open editor only for external plugins, not built-ins (they have no native UI)", async () => {
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
        { format: "builtin", path: "Delay", pluginName: null, name: "Delay", stateB64: null },
      ],
    };
    const fetchMock = stubChainFileGet(chain);
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await renderVstSectionAsync(makeVstHost());

    const rows = host.querySelectorAll('[data-vst-plugin-row="true"]');
    expect(rows).toHaveLength(2);
    // vst3 row (Reverb) has Open editor; builtin row (Delay) does not.
    expect(rows[0]?.querySelector('[data-vst-open-editor="true"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-vst-open-editor="true"]')).toBeNull();
    act(() => root.unmount());
  });
});

describe("VstSection — built-in parameters", () => {
  it("renders sliders seeded from live state and applies edits via setParam", async () => {
    const chain: ChainFileJson = {
      version: 1,
      plugins: [
        { format: "builtin", path: "Delay", pluginName: null, name: "Delay", stateB64: null },
      ],
    };
    const fetchMock = stubChainFileGet(chain);
    vi.stubGlobal("fetch", fetchMock);

    const setParam = vi.fn();
    // The sidecar's live state for a built-in is base64(JSON of {param: value}).
    const liveState = btoa(JSON.stringify({ mix: 0.5, feedback: 0.2 }));
    const vstHost = makeVstHost({ setParam, getState: vi.fn(async () => [liveState]) });

    const { host, root } = await renderVstSectionAsync(vstHost);

    const sliders = host.querySelectorAll("[data-vst-param]");
    expect(sliders.length).toBe(2); // mix + feedback

    const mix = host.querySelector<HTMLInputElement>('[data-vst-param="mix"]');
    expect(mix).not.toBeNull();
    if (mix) {
      // Bypass React's value-tracker (a direct `.value =` is swallowed) so the
      // synthetic onChange fires, mirroring a real slider drag.
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(mix, "0.8");
      await act(async () => {
        mix.dispatchEvent(new Event("input", { bubbles: true }));
        await flushAsyncWork();
      });
    }
    // Live audio update: set-param on the streaming instance, plugin index 0.
    expect(setParam).toHaveBeenCalledWith("vo-1", 0, "mix", 0.8);

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

    // Registry already populated → the picker's options appear without a scan.
    const { host, root } = await renderVstSectionForAdd(vstHost, onSetAttribute);

    await selectAddOption(host, 0);
    await act(async () => {
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

  it("keeps the picker visible with an existing chain and APPENDS the picked effect to it", async () => {
    // Regression: the picker used to render only while the element had no
    // chain, so after the first add there was no UI to stack a second effect.
    const existing: ChainFileJson = {
      version: 1,
      plugins: [
        { format: "builtin", path: "Reverb", pluginName: null, name: "Reverb", stateB64: null },
      ],
    };
    const onSetAttribute = vi.fn();
    const { fetchMock, written } = stubChainFilePutCapture(existing);
    vi.stubGlobal("fetch", fetchMock);

    const vstHost = makeVstHost({
      registry: [{ path: "Delay", name: "Delay", format: "builtin" }],
    });

    const { host, root } = await renderVstSectionAsync(vstHost, { onSetAttribute });

    // The picker must still be offered even though a chain already exists.
    expect(host.querySelector('[data-vst-add-effect="true"]')).not.toBeNull();

    await selectAddOption(host, 0);
    await act(async () => {
      await flushAsyncWork();
    });

    expect(written()?.plugins.map((p) => p.name)).toEqual(["Reverb", "Delay"]); // appended, not replaced
    // The attribute is already committed — re-setting it would trigger a
    // needless preview reload.
    expect(onSetAttribute).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("scans for available effects when the registry is empty, then adds the picked one", async () => {
    const onSetAttribute = vi.fn();
    const fetchMock = vi.fn(async (): Promise<Response> => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const registry = [{ path: "/plugins/Reverb.vst3", name: "Reverb", format: "vst3" }];
    const scan = vi.fn(async () => {
      vstHost.registry = registry;
    });
    const vstHost = makeVstHost({ registry: [], scan });

    // Empty registry → the panel scans once on mount to populate the picker.
    const { host, root } = await renderVstSectionForAdd(vstHost, onSetAttribute);
    expect(scan).toHaveBeenCalledTimes(1);

    await selectAddOption(host, 0);
    await act(async () => {
      await flushAsyncWork();
    });

    expect(onSetAttribute).toHaveBeenCalledWith("vst-chain", "fx/vo-1.vstchain.json");
    act(() => root.unmount());
  });

  it("marks a picked builtin's format as builtin with no pluginName", async () => {
    const onSetAttribute = vi.fn();
    let putBody: unknown;
    const fetchMock = vi.fn(async (input, init): Promise<Response> => {
      if (init?.method === "PUT") {
        putBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${requestUrl(input)} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const vstHost = makeVstHost({
      registry: [{ path: "Reverb", name: "Reverb", format: "builtin" }],
    });

    const { host, root } = await renderVstSectionForAdd(vstHost, onSetAttribute);
    await selectAddOption(host, 0);
    await act(async () => {
      await flushAsyncWork();
    });

    expect(putBody).toMatchObject({
      version: 1,
      plugins: [{ format: "builtin", path: "Reverb", pluginName: null, name: "Reverb" }],
    });
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

  /** Enables the fake timers the poll interval under test needs, and stubs
   *  `fetch` to serve `existingChain` on GET / accept a PUT — the shared
   *  setup every test below needs. Returns the fetchMock so callers can
   *  inspect its PUT calls. */
  function setupPollingFixture(): ReturnType<typeof vi.fn> {
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
    return fetchMock;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sets up the polling fixture + a `getState` returning `stateValues`,
   *  renders the section, and locates the "Open editor" button — the shared
   *  setup every poll test below needs. */
  async function setupPolledEditor(
    stateValues: string[],
    overrides: { domEditSaveTimestampRef?: { current: number } } = {},
  ): Promise<{
    host: HTMLElement;
    root: ReturnType<typeof renderInto>["root"];
    fetchMock: ReturnType<typeof vi.fn>;
    vstHost: VstHostApi;
    openButton: HTMLButtonElement | null;
  }> {
    const fetchMock = setupPollingFixture();
    const getState = vi.fn(async () => stateValues);
    const vstHost = makeVstHost({ getState });
    const { host, root } = await renderVstSectionAsync(vstHost, overrides);
    const openButton = host.querySelector<HTMLButtonElement>('[data-vst-open-editor="true"]');
    return { host, root, fetchMock, vstHost, openButton };
  }

  it("polls getState after 'Open editor' and PUTs the chain file when state changed", async () => {
    const { root, fetchMock, vstHost, openButton } = await setupPolledEditor(["NEW_STATE_B64"]);

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

    expect(vstHost.getState).toHaveBeenCalledWith("vo-1");
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const body = putCall?.[1]?.body;
    if (typeof body !== "string") throw new Error("expected a string PUT body");
    const written = parseChainFile(body);
    expect(written?.plugins[0]?.stateB64).toBe("NEW_STATE_B64");

    act(() => root.unmount());
  });

  it("stamps domEditSaveTimestampRef after a poll-triggered PUT (suppresses the studio's own file-change reload)", async () => {
    const domEditSaveTimestampRef = { current: 0 };
    const { root, fetchMock, openButton } = await setupPolledEditor(["NEW_STATE_B64"], {
      domEditSaveTimestampRef,
    });

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
    const fetchMock = stubChainFileGet(existingChain);
    vi.stubGlobal("fetch", fetchMock);

    const getState = vi.fn(async () => ["AAAA"]); // matches existingChain's stateB64 already
    const vstHost = makeVstHost({ getState });

    const { host, root } = await renderVstSectionAsync(vstHost);

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
    const { root, fetchMock, openButton } = await setupPolledEditor(["NEW_STATE_B64"]);

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

// ── "Make room for voiceover" carve action ─────────────────────────────────

describe("VstSection — make room for voiceover", () => {
  afterEach(() => {
    usePlayerStore.setState({ elements: [] });
  });

  /** Two audio tracks: the selected music track + a voiceover track — the
   *  shared timeline shape every carve test below needs. */
  function setTwoTrackElements(): void {
    usePlayerStore.setState({
      elements: [
        { id: "music", src: "./media/music.wav", tag: "audio", timelineRole: "music" },
        { id: "vo", src: "./media/vo.wav", tag: "audio", timelineRole: "voiceover" },
      ],
    } as never);
  }

  /** The music element the carve action targets — created fresh per test. */
  function makeMusicElement(): DomEditSelection {
    return makeAudioElement({
      id: "music",
      dataAttributes: { "vst-chain": "fx/music.vstchain.json" },
    });
  }

  /** Stubs `fetch` for the carve flow: `/api/vst/carve` returns `bands`, PUT
   *  accepts, and GET serves `existingChain` — the shared mock shape every
   *  carve test below needs. */
  function stubCarveFetch(
    bands: CarveBand[],
    existingChain: ChainFileJson,
  ): ReturnType<typeof vi.fn> {
    return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/api/vst/carve")) {
        return jsonResponse({ bands });
      }
      if (init?.method === "PUT") return jsonResponse({ ok: true });
      return jsonResponse({ content: serializeChainFile(existingChain) });
    });
  }

  it("carves a voiceover pocket: calls /vst/carve and appends PeakFilter bands", async () => {
    setTwoTrackElements();

    const fetchMock = stubCarveFetch([{ freq: 1000, gainDb: -4, q: 1.5 }], {
      version: 1,
      plugins: [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const { host, root } = await renderVstSectionAsync(makeVstHost(), {
      element: makeMusicElement(),
    });

    const openButton = host.querySelector<HTMLButtonElement>('[data-vst-carve-open="true"]');
    expect(openButton).not.toBeNull();
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    // VO dropdown pre-selects the voiceover-tagged track.
    const voSelect = host.querySelector<HTMLSelectElement>('[data-vst-carve-voice="true"]');
    expect(voSelect).not.toBeNull();
    expect(voSelect?.value).toBe("vo");

    const applyButton = host.querySelector<HTMLButtonElement>('[data-vst-carve-apply="true"]');
    expect(applyButton).not.toBeNull();
    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeTruthy();
    const written = parseChainFile(String(putCall?.[1]?.body));
    expect(written?.plugins.some((p) => p.path === "PeakFilter")).toBe(true);

    act(() => root.unmount());
  });

  it("re-applying carve updates the DISPLAYED gain sliders, not just the file", async () => {
    // Regression: the param-seed effect is keyed on chain STRUCTURE (formats
    // + paths) so knob drags don't re-seed — but a carve re-run keeps the
    // same PeakFilter structure and only changes gains, so the rows kept
    // showing the PREVIOUS run's values. Judged by the displayed numbers,
    // the amount slider "did nothing" even though the file was right.
    setTwoTrackElements();

    // Existing chain: one carve band at the OLD gain (-2), whose value the
    // sidecar's getState also reports (stale, pre-re-carve).
    const oldState = btoa(JSON.stringify({ cutoff_frequency_hz: 1000, gain_db: -2, q: 1.5 }));
    const existing: ChainFileJson = {
      version: 1,
      plugins: [
        {
          format: "builtin",
          path: "PeakFilter",
          pluginName: null,
          name: "Carve 1000Hz",
          stateB64: oldState,
        },
      ],
    };
    // NEW deeper gain on re-carve.
    const fetchMock = stubCarveFetch([{ freq: 1000, gainDb: -6, q: 1.5 }], existing);
    vi.stubGlobal("fetch", fetchMock);

    const vstHost = makeVstHost({ getState: vi.fn(async () => [oldState]) });

    const { host, root } = await renderVstSectionAsync(vstHost, { element: makeMusicElement() });

    // Sliders seeded from the sidecar's (old) state.
    const gainInput = () => host.querySelector<HTMLInputElement>('input[data-vst-param="gain_db"]');
    expect(gainInput()?.value).toBe("-2");

    await act(async () => {
      host
        .querySelector('[data-vst-carve-open="true"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });
    await act(async () => {
      host
        .querySelector('[data-vst-carve-apply="true"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    // The displayed gain must reflect the NEW carve immediately.
    expect(gainInput()?.value).toBe("-6");

    act(() => root.unmount());
  });
});
