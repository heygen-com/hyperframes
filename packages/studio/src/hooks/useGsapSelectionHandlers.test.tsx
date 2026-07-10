// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { useGsapSelectionHandlers } from "./useGsapSelectionHandlers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Params = Parameters<typeof useGsapSelectionHandlers>[0];
type Handlers = ReturnType<typeof useGsapSelectionHandlers>;

function makeSelection(): DomEditSelection {
  return {
    id: "box",
    hfId: "hf-box",
    selector: "#box",
    sourceFile: "index.html",
    element: document.createElement("div"),
  } as unknown as DomEditSelection;
}

function makeParams(overrides: Partial<Params> = {}): Params {
  const resolved = () => vi.fn().mockResolvedValue(undefined);
  return {
    domEditSelection: makeSelection(),
    updateGsapProperty: vi.fn(),
    updateGsapMeta: resolved(),
    deleteGsapAnimation: resolved(),
    deleteAllForSelector: resolved(),
    addGsapAnimation: resolved(),
    addGsapProperty: resolved(),
    removeGsapProperty: resolved(),
    updateGsapFromProperty: resolved(),
    addGsapFromProperty: resolved(),
    removeGsapFromProperty: resolved(),
    addKeyframe: vi.fn(),
    addKeyframeBatch: resolved(),
    removeKeyframe: vi.fn(),
    moveKeyframe: vi.fn(),
    resizeKeyframedTween: vi.fn(),
    convertToKeyframes: resolved(),
    removeAllKeyframes: resolved(),
    handleDomManualEditsReset: vi.fn(),
    selectedGsapAnimations: [],
    showToast: vi.fn(),
    ...overrides,
  };
}

function renderHandlers(params: Params): { handlers: () => Handlers; unmount: () => void } {
  let current: Handlers | undefined;
  function Probe() {
    current = useGsapSelectionHandlers(params);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return {
    handlers: () => {
      if (!current) throw new Error("Hook did not render");
      return current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

async function flushRejection(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useGsapSelectionHandlers save failures", () => {
  it("surfaces a rejected animation metadata save", async () => {
    const error = new Error("write failed");
    const showToast = vi.fn();
    const rendered = renderHandlers(
      makeParams({ updateGsapMeta: vi.fn().mockRejectedValue(error), showToast }),
    );

    act(() => rendered.handlers().handleGsapUpdateMeta("anim-1", { duration: 2 }));
    await flushRejection();

    expect(showToast).toHaveBeenCalledWith("Couldn't save animation: write failed", "error");
    rendered.unmount();
  });

  it("surfaces a rejected non-debounced property save", async () => {
    const error = new Error("write failed");
    const showToast = vi.fn();
    const rendered = renderHandlers(
      makeParams({ addGsapProperty: vi.fn().mockRejectedValue(error), showToast }),
    );

    act(() => rendered.handlers().handleGsapAddProperty("anim-1", "opacity"));
    await flushRejection();

    expect(showToast).toHaveBeenCalledWith("Couldn't save animation: write failed", "error");
    rendered.unmount();
  });

  it("does not duplicate a toast already emitted by the mutation request", async () => {
    const error = Object.assign(new Error("write failed"), { alreadyToasted: true });
    const showToast = vi.fn();
    const rendered = renderHandlers(
      makeParams({ addGsapAnimation: vi.fn().mockRejectedValue(error), showToast }),
    );

    act(() => rendered.handlers().handleGsapAddAnimation("to"));
    await flushRejection();

    expect(showToast).not.toHaveBeenCalled();
    rendered.unmount();
  });
});
