// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "../hooks/domSelectionTestHarness";
import { writeStudioUiPreferences } from "../utils/studioUiPreferences";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import type { ModelContext, ModelContextRegisterToolOptions, ModelContextTool } from "./types";
import type { StudioLookSnapshot } from "./tools/lookTools";

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock("../telemetry/client", () => ({ trackEvent }));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let cleanup: (() => void) | null = null;

function snapshot(overrides: Partial<StudioLookSnapshot> = {}): StudioLookSnapshot {
  return {
    projectId: "demo",
    compositionPath: "index.html",
    currentTime: 0,
    duration: 10,
    isPlaying: false,
    elements: [],
    selection: null,
    selectionAnimationCount: 0,
    history: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null },
    ...overrides,
  };
}

/** Install a fake `document.modelContext` and report what got registered. */
function installModelContext() {
  const registered: ModelContextTool[] = [];
  const registerTool = vi.fn(
    async (tool: ModelContextTool, _options?: ModelContextRegisterToolOptions) => {
      registered.push(tool);
    },
  );
  const modelContext: ModelContext = { registerTool };
  Object.defineProperty(document, "modelContext", {
    value: modelContext,
    configurable: true,
    writable: true,
  });
  return { registered, registerTool };
}

function removeModelContext() {
  Reflect.deleteProperty(document, "modelContext");
}

function mountTools(deps: StudioAgentToolsDeps) {
  function Probe({ current }: { current: StudioAgentToolsDeps }) {
    useStudioAgentTools(current);
    return null;
  }
  const root = mountReactHarness(<Probe current={deps} />);
  cleanup = () => act(() => root.unmount());
  return {
    rerenderWith(next: StudioAgentToolsDeps) {
      act(() => root.render(<Probe current={next} />));
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  trackEvent.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  removeModelContext();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useStudioAgentTools", () => {
  it("registers the tool set once on mount", async () => {
    const { registered } = installModelContext();

    await act(async () => {
      mountTools({ getSnapshot: () => snapshot() });
    });

    expect(registered.map((tool) => tool.name)).toEqual(["studio_look"]);
  });

  it("does not re-register when the deps object changes identity", async () => {
    // The regression test for the whole design. The DomEdit actions object
    // changes identity on nearly every interaction; if registration depended on
    // it, the signal would abort and unregister the tools each time.
    const { registerTool } = installModelContext();

    let harness: ReturnType<typeof mountTools> | null = null;
    await act(async () => {
      harness = mountTools({ getSnapshot: () => snapshot() });
    });
    expect(registerTool).toHaveBeenCalledTimes(1);

    await act(async () => {
      harness?.rerenderWith({ getSnapshot: () => snapshot({ currentTime: 5 }) });
      harness?.rerenderWith({ getSnapshot: () => snapshot({ currentTime: 6 }) });
    });

    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("executes against the LATEST deps, not the ones present at registration", async () => {
    // The other half of the ref: registering once must not freeze the state the
    // tools read, or every answer after the first render would be stale.
    const { registered } = installModelContext();

    let harness: ReturnType<typeof mountTools> | null = null;
    await act(async () => {
      harness = mountTools({ getSnapshot: () => snapshot({ currentTime: 1 }) });
    });

    await act(async () => {
      harness?.rerenderWith({ getSnapshot: () => snapshot({ currentTime: 42 }) });
    });

    const look = registered[0];
    if (!look) throw new Error("expected studio_look to be registered");
    const result = (await look.execute({}, { signal: new AbortController().signal })) as {
      ok: boolean;
      playhead: number;
    };

    expect(result.ok).toBe(true);
    expect(result.playhead).toBe(42);
  });

  it("unregisters on unmount by aborting the registration signal", async () => {
    const { registerTool } = installModelContext();

    await act(async () => {
      mountTools({ getSnapshot: () => snapshot() });
    });
    const signal = registerTool.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    cleanup?.();
    cleanup = null;

    expect(signal?.aborted).toBe(true);
  });

  it("registers nothing when the browser has no WebMCP", async () => {
    removeModelContext();

    await act(async () => {
      mountTools({ getSnapshot: () => snapshot() });
    });

    // The assertion is that mounting did not throw; a browser without the API
    // must still boot Studio.
    expect(document).not.toHaveProperty("modelContext");
  });

  it("registers nothing when the preference is turned off", async () => {
    writeStudioUiPreferences({ agentToolsEnabled: false });
    const { registerTool } = installModelContext();

    await act(async () => {
      mountTools({ getSnapshot: () => snapshot() });
    });

    expect(registerTool).not.toHaveBeenCalled();
  });

  it("registers when the preference is absent, because on is the default", async () => {
    const { registerTool } = installModelContext();

    await act(async () => {
      mountTools({ getSnapshot: () => snapshot() });
    });

    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("reports a non-abort registration failure through production telemetry", async () => {
    const { registerTool } = installModelContext();
    registerTool.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));

    await act(async () => {
      mountTools({ getSnapshot: () => snapshot() });
    });

    expect(trackEvent).toHaveBeenCalledWith("webmcp_registration_failed", {
      error_name: "NotAllowedError",
      tool_name: "studio_look",
    });
  });

  it("reports a tool that throws as an internal failure instead of rejecting", async () => {
    const { registered } = installModelContext();

    await act(async () => {
      mountTools({
        getSnapshot: () => {
          throw new TypeError("handler signature moved");
        },
      });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const look = registered[0];
    if (!look) throw new Error("expected studio_look to be registered");
    const result = (await look.execute({}, { signal: new AbortController().signal })) as {
      ok: boolean;
      kind: string;
    };

    expect(result.ok).toBe(false);
    expect(result.kind).toBe("internal");
  });
});
