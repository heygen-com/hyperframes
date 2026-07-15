// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VstSection, type VstHostApi } from "./propertyPanelVstSection";
import type { DomEditSelection } from "./domEditing";
import { serializeChainFile, type ChainFileJson } from "../../utils/vstChainFile";

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
    loadChain: vi.fn(async () => {}),
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
