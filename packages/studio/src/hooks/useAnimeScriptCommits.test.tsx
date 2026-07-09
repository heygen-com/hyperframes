// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { useAnimeScriptCommits } from "./useAnimeScriptCommits";

const applySoftReload = vi.fn<(...args: unknown[]) => string>();

vi.mock("../utils/gsapSoftReload", () => ({
  applySoftReload: (...args: unknown[]) => applySoftReload(...args),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookApi = ReturnType<typeof useAnimeScriptCommits>;

const selection = { id: "box", selector: "#box", sourceFile: "index.html" } as DomEditSelection;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderHook(captured: { api: HookApi | null }, deps: { reloadPreview: () => void }) {
  function Probe() {
    captured.api = useAnimeScriptCommits({
      projectIdRef: { current: "proj-1" },
      activeCompPath: "index.html",
      previewIframeRef: { current: null },
      editHistory: { recordEdit: vi.fn(async () => {}) },
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: deps.reloadPreview,
      onCacheInvalidate: vi.fn(),
      onFileContentChanged: vi.fn(),
      showToast: vi.fn(),
      sdkSession: null,
      writeProjectFile: undefined,
      forceReloadSdkSession: vi.fn(),
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  applySoftReload.mockReset();
  document.body.innerHTML = "";
});

describe("useAnimeScriptCommits", () => {
  it("preserves anime array-form property values when updating the editable end value", async () => {
    applySoftReload.mockReturnValue("applied");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          animations: [
            {
              id: "anim-1",
              method: "add",
              targetSelector: "#box",
              properties: { translateX: [0, 100] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          changed: true,
          before: "<old>",
          after: "<new>",
          scriptText: "const tl = anime.createTimeline({ autoplay: false });",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const captured: { api: HookApi | null } = { api: null };
    const root = renderHook(captured, { reloadPreview: vi.fn() });

    await act(async () => {
      await captured.api?.updateAnimeProperty(selection, "anim-1", "translateX", 42);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const mutationRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(mutationRequest?.body))).toEqual({
      type: "update-property",
      animationId: "anim-1",
      property: "translateX",
      value: [0, 42],
    });
    expect(applySoftReload).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
