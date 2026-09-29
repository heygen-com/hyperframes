// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { useGsapAnimationOps } from "./useGsapAnimationOps";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookApi = ReturnType<typeof useGsapAnimationOps>;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const selection = { id: "box", selector: "#box" } as DomEditSelection;

function renderOps(
  commitMutationSafely: (...args: unknown[]) => Promise<void>,
  commitMutation: (...args: unknown[]) => Promise<void> = vi.fn(async () => undefined),
): HookApi {
  const captured: { api: HookApi | null } = { api: null };
  function Probe() {
    captured.api = useGsapAnimationOps({
      projectIdRef: { current: "project" },
      activeCompPath: "index.html",
      commitMutation,
      commitMutationSafely,
      showToast: vi.fn(),
      sdkSession: null,
      sdkDeps: null,
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  cleanup = () => act(() => root.unmount());
  if (!captured.api) throw new Error("hook did not initialize");
  return captured.api;
}

function deferredCommit() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { commitMutationSafely: vi.fn(() => promise), release };
}

describe("useGsapAnimationOps settlement", () => {
  it.each([
    ["update", (api: HookApi) => api.updateGsapMeta(selection, "anim-1", { duration: 2 })],
    ["delete", (api: HookApi) => api.deleteGsapAnimation(selection, "anim-1")],
  ])("keeps %s pending until the shared preview synchronizer settles", async (_name, run) => {
    const deferred = deferredCommit();
    const api = renderOps(deferred.commitMutationSafely);
    let settled = false;

    const resultPromise = run(api).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.release();
    await resultPromise;
    expect(settled).toBe(true);
  });

  it("soft-reloads the preview when adding an animation", async () => {
    const commitMutation = vi.fn(async () => undefined);
    const api = renderOps(
      vi.fn(async () => undefined),
      commitMutation,
    );

    await api.addGsapAnimation(selection, "from");

    expect(commitMutation).toHaveBeenCalledWith(
      selection,
      expect.objectContaining({ type: "add" }),
      expect.objectContaining({ softReload: true }),
    );
  });

  it("soft-reloads the preview when deleting an animation", async () => {
    const commitMutationSafely = vi.fn(async () => undefined);
    const api = renderOps(commitMutationSafely);

    await api.deleteGsapAnimation(selection, "anim-1");

    expect(commitMutationSafely).toHaveBeenCalledWith(
      selection,
      expect.objectContaining({ type: "delete" }),
      expect.objectContaining({ softReload: true }),
    );
  });
});
