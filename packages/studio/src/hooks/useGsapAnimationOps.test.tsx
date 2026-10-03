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
  vi.unstubAllGlobals();
  document.body.replaceChildren();
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

  it.each([
    ["saved", { status: 200, body: { changed: true } }, "div"],
    ["refused", { status: 409, body: { error: "file changed" } }, null],
  ])("an id-less element keeps its minted id only when the id write is %s", async (_name, reply, id) => {
    const element = document.body.appendChild(document.createElement("div"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const commitMutation = vi.fn(async () => undefined);
    const api = renderOps(
      vi.fn(async () => undefined),
      commitMutation,
    );

    await api.addGsapAnimation({ element, hfId: "hf-1" } as unknown as DomEditSelection, "from");

    expect(element.getAttribute("id")).toBe(id);
    expect(commitMutation).toHaveBeenCalledTimes(id ? 1 : 0);
  });

  it("mints different ids for two adds whose id writes overlap", async () => {
    const first = document.body.appendChild(document.createElement("div"));
    const second = document.body.appendChild(document.createElement("div"));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) await held;
      return new Response(JSON.stringify({ changed: true }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = renderOps(vi.fn(async () => undefined));
    const add = (element: HTMLElement, hfId: string) =>
      api.addGsapAnimation({ element, hfId } as unknown as DomEditSelection, "from");

    const adding = add(first, "hf-1");
    await add(second, "hf-2");
    release();
    await adding;

    const ids = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).operations[0].value,
    );
    expect(ids).toEqual(["div", "div-2"]);
    expect([first.id, second.id]).toEqual(["div", "div-2"]);
  });

  it("drops the minted id when the id write fails on the network", async () => {
    const element = document.body.appendChild(document.createElement("div"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const api = renderOps(vi.fn(async () => undefined));

    await expect(
      api.addGsapAnimation({ element, hfId: "hf-1" } as unknown as DomEditSelection, "from"),
    ).rejects.toThrow("offline");
    expect(element.hasAttribute("id")).toBe(false);
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
