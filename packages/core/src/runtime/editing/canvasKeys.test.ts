// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_PREVIEW_CAPTURE_MODE, STUDIO_PREVIEW_MARK_META } from "../../studioPreviewMark";
import { installEditingAgent } from "../editingAgent";
import { EDITING_CONNECT, EDITING_PORT, EDITING_PROTOCOL_VERSION } from "../editingPort";
import { installPreviewKeyShield, resetCanvasKeys } from "./canvasKeys";

function markStudio(content?: string): HTMLMetaElement {
  const meta = document.createElement("meta");
  meta.name = STUDIO_PREVIEW_MARK_META;
  if (content) meta.content = content;
  document.head.append(meta);
  return meta;
}

function trustedKey(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

function untrustedKey(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

function connectAgent(parent: Window): { port: MessagePort; dispose: () => void } {
  let received: MessagePort | null = null;
  const parentWin = parent as Window & { postMessage: typeof window.postMessage };
  parentWin.postMessage = ((data: unknown, _origin: string, transfer?: Transferable[]) => {
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === EDITING_PORT
    ) {
      received = (transfer?.[0] as MessagePort | undefined) ?? null;
    }
  }) as typeof window.postMessage;
  const agent = installEditingAgent(parent);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      data: { source: "hf-parent", type: EDITING_CONNECT, v: EDITING_PROTOCOL_VERSION },
    }),
  );
  if (!received) throw new Error("editing agent did not hand over a port");
  return { port: received, dispose: agent.dispose };
}

function ask(port: MessagePort, kind: string, params: unknown): Promise<Record<string, unknown>> {
  const id = Math.floor(Math.random() * 1_000_000) + 1;
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<Record<string, unknown>>) => {
      if (event.data?.id !== id) return;
      port.removeEventListener("message", onMessage);
      resolve(event.data);
    };
    port.addEventListener("message", onMessage);
    port.start?.();
    port.postMessage({ v: EDITING_PROTOCOL_VERSION, id, kind, params });
  });
}

describe("canvasKeys in-frame keyboard shield and actions", () => {
  let disposeAgent: (() => void) | null = null;
  let fakeParent: Window;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    resetCanvasKeys(true);
    fakeParent = {} as Window;
  });

  afterEach(() => {
    disposeAgent?.();
    disposeAgent = null;
    resetCanvasKeys(true);
    vi.unstubAllGlobals();
    delete (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG;
    delete (window as { gsap?: unknown }).gsap;
    delete (window as { __timelines?: unknown }).__timelines;
  });

  it("blocks film listeners, ignores untrusted keys, and removes armed targets in the same frame", async () => {
    vi.stubGlobal("origin", "null");
    markStudio();
    document.body.innerHTML = `<div data-composition-id="main"><div id="target">box</div><input id="film-input" /></div>`;
    const shieldStop = installPreviewKeyShield(window, fakeParent);
    const filmSaw: string[] = [];
    const onFilmKey = (e: Event) => filmSaw.push((e as KeyboardEvent).key);
    window.addEventListener("keydown", onFilmKey, true);
    document.addEventListener("keydown", onFilmKey, true);

    const { port, dispose } = connectAgent(fakeParent);
    disposeAgent = () => {
      window.removeEventListener("keydown", onFilmKey, true);
      document.removeEventListener("keydown", onFilmKey, true);
      shieldStop();
      dispose();
    };

    const events: Record<string, unknown>[] = [];
    port.addEventListener("message", (e: MessageEvent<Record<string, unknown>>) => {
      if (e.data?.event) events.push(e.data);
    });
    port.start?.();

    const queryReply = await ask(port, "query", { selector: "#target" });
    const handle = (queryReply.result as { matches: Array<{ handle: string }> }).matches[0]!.handle;

    await ask(port, "arm-canvas-keys", {
      revision: 1,
      deleteHandles: [handle],
      deleteCombos: ["Delete", "Backspace"],
      nudge: null,
      forwardCombos: ["Space", "mod+z"],
    });

    // Untrusted Delete must be ignored completely.
    window.dispatchEvent(untrustedKey("keydown", { key: "Delete" }));
    expect(document.getElementById("target")).not.toBeNull();
    expect(events).toHaveLength(0);

    // Trusted key and beforeinput on a film-owned <input> must be blocked (never carved out).
    filmSaw.length = 0;
    const filmInput = document.getElementById("film-input")!;
    const blockedInput = new Event("beforeinput", { bubbles: true, cancelable: true });
    Object.defineProperty(blockedInput, "isTrusted", { value: true });
    filmInput.dispatchEvent(blockedInput);
    expect(blockedInput.defaultPrevented).toBe(true);
    const blockedKey = trustedKey("keydown", { key: "y", code: "KeyY" });
    filmInput.dispatchEvent(blockedKey);
    expect(blockedKey.defaultPrevented).toBe(true);
    expect(filmSaw).toEqual([]);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ event: "key", key: { type: "keydown", key: "y" } });
    events.length = 0;

    // Trusted Delete removes #target immediately and posts canvas-key-action.
    filmSaw.length = 0;
    const delEvent = trustedKey("keydown", { key: "Delete", code: "Delete" });
    window.dispatchEvent(delEvent);
    expect(delEvent.defaultPrevented).toBe(true);
    expect(document.getElementById("target")).toBeNull();
    expect(filmSaw).toEqual([]);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      event: "canvas-key-action",
      action: "delete",
      revision: 1,
      handles: [handle],
    });
  });

  it("accumulates rapid key-repeat Arrow nudges across translate and GSAP targets before Studio replies", async () => {
    markStudio();
    document.body.innerHTML = `<div data-composition-id="main"><div id="plain"></div><div id="animated"></div></div>`;
    const animated = document.getElementById("animated")!;
    const gsapState = { x: 40, y: 10 };
    (window as unknown as { gsap: unknown; __timelines: unknown }).gsap = {
      getProperty: (_el: Element, prop: string) =>
        prop === "x" ? gsapState.x : prop === "y" ? gsapState.y : 0,
      set: (_el: Element, vars: Record<string, number>) => {
        if (typeof vars.x === "number") gsapState.x = vars.x;
        if (typeof vars.y === "number") gsapState.y = vars.y;
      },
    };
    (window as unknown as { __timelines: unknown }).__timelines = {
      main: {
        getChildren: () => [{ vars: { x: 100 }, targets: () => [animated], duration: () => 0 }],
      },
    };

    const { port, dispose } = connectAgent(fakeParent);
    disposeAgent = dispose;
    const actions: Record<string, unknown>[] = [];
    port.addEventListener("message", (e: MessageEvent<Record<string, unknown>>) => {
      if (e.data?.event === "canvas-key-action") actions.push(e.data);
    });
    port.start?.();

    const hPlain = (
      (await ask(port, "query", { selector: "#plain" })).result as {
        matches: Array<{ handle: string }>;
      }
    ).matches[0]!.handle;
    const hAnim = (
      (await ask(port, "query", { selector: "#animated" })).result as {
        matches: Array<{ handle: string }>;
      }
    ).matches[0]!.handle;

    await ask(port, "arm-canvas-keys", {
      revision: 2,
      deleteHandles: [],
      deleteCombos: [],
      nudge: {
        handles: [hPlain, hAnim],
        combos: [
          { combo: "ArrowRight", dx: 1, dy: 0 },
          { combo: "shift+ArrowDown", dx: 0, dy: 10 },
        ],
      },
      forwardCombos: [],
    });

    // Rapid repeat nudges synchronously before Studio sends any reply.
    window.dispatchEvent(trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight" }));
    window.dispatchEvent(
      trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight", repeat: true }),
    );
    window.dispatchEvent(
      trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight", repeat: true }),
    );
    window.dispatchEvent(
      trustedKey("keydown", { key: "ArrowDown", code: "ArrowDown", shiftKey: true }),
    );

    const plainTranslate = document.getElementById("plain")!.style.getPropertyValue("translate");
    expect(plainTranslate).toContain("3px");
    expect(plainTranslate).toContain("10px");
    expect(gsapState).toEqual({ x: 43, y: 20 });

    await vi.waitFor(() => expect(actions).toHaveLength(4));
    expect(actions.map((a) => [a.totalDx, a.totalDy])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 10],
    ]);
    expect(actions[3]?.drafts).toMatchObject({
      [hPlain]: expect.any(Number),
      [hAnim]: expect.any(Number),
    });
    // Every step reports the GSAP start from before the first draw, never the drawn position.
    expect(actions.map((a) => a.baseGsap)).toEqual(Array(4).fill({ [hAnim]: { x: 40, y: 10 } }));
  });

  it("handles a second Delete while an actionId is in-flight and restores only rolled-back elements", async () => {
    markStudio();
    document.body.innerHTML = `<div data-composition-id="main"><div id="a">A</div><div id="b">B</div><div id="c">C</div></div>`;
    const { port, dispose } = connectAgent(fakeParent);
    disposeAgent = dispose;
    const deletes: Array<{ actionId: number; handles: string[] }> = [];
    port.addEventListener("message", (e: MessageEvent<Record<string, unknown>>) => {
      if (e.data?.event === "canvas-key-action" && e.data.action === "delete") {
        deletes.push(e.data as unknown as { actionId: number; handles: string[] });
      }
    });
    port.start?.();

    const hA = (
      (await ask(port, "query", { selector: "#a" })).result as {
        matches: Array<{ handle: string }>;
      }
    ).matches[0]!.handle;
    const hB = (
      (await ask(port, "query", { selector: "#b" })).result as {
        matches: Array<{ handle: string }>;
      }
    ).matches[0]!.handle;

    await ask(port, "arm-canvas-keys", {
      revision: 1,
      deleteHandles: [hA],
      deleteCombos: ["Delete"],
      nudge: null,
      forwardCombos: [],
    });

    // First Delete removes #a immediately; a rapid second Delete on the same armed state does not double-fire.
    window.dispatchEvent(trustedKey("keydown", { key: "Delete" }));
    window.dispatchEvent(trustedKey("keydown", { key: "Delete" }));
    expect(document.getElementById("a")).toBeNull();
    await vi.waitFor(() => expect(deletes).toHaveLength(1));
    const firstActionId = deletes[0]!.actionId;

    // Arm #b while firstActionId is still in-flight, then Delete #b too.
    await ask(port, "arm-canvas-keys", {
      revision: 2,
      deleteHandles: [hB],
      deleteCombos: ["Delete"],
      nudge: null,
      forwardCombos: [],
    });
    window.dispatchEvent(trustedKey("keydown", { key: "Delete" }));
    expect(document.getElementById("b")).toBeNull();
    await vi.waitFor(() => expect(deletes).toHaveLength(2));
    const secondActionId = deletes[1]!.actionId;

    // Roll back firstActionId: #a returns in its exact position before #c, while #b stays removed.
    const rollback = await ask(port, "resolve-canvas-key-action", {
      actionId: firstActionId,
      outcome: "rollback",
    });
    expect(rollback.result).toEqual({ resolved: true, restored: 1 });
    expect(document.getElementById("a")).not.toBeNull();
    expect(document.getElementById("b")).toBeNull();
    expect([...document.querySelector("[data-composition-id]")!.children].map((n) => n.id)).toEqual(
      ["a", "c"],
    );

    const commit = await ask(port, "resolve-canvas-key-action", {
      actionId: secondActionId,
      outcome: "commit",
    });
    expect(commit.result).toEqual({ resolved: true, restored: 0 });
  });

  it("carves out active Studio textEdit sessions and forwards other Studio shortcuts", async () => {
    markStudio();
    document.body.innerHTML = `<div data-composition-id="main"><h1 id="title">Hello</h1></div>`;
    const { port, dispose } = connectAgent(fakeParent);
    disposeAgent = dispose;
    const forwarded: Array<Record<string, unknown>> = [];
    const ended: Array<Record<string, unknown>> = [];
    port.addEventListener("message", (e: MessageEvent<Record<string, unknown>>) => {
      if (e.data?.event === "key") forwarded.push(e.data.key as Record<string, unknown>);
      if (e.data?.event === "text-edit-ended") ended.push(e.data);
    });
    port.start?.();

    const hTitle = (
      (await ask(port, "query", { selector: "#title" })).result as {
        matches: Array<{ handle: string }>;
      }
    ).matches[0]!.handle;

    await ask(port, "arm-canvas-keys", {
      revision: 3,
      deleteHandles: [hTitle],
      deleteCombos: ["Delete", "Backspace"],
      nudge: null,
      forwardCombos: ["Space", "mod+z", "Escape"],
    });

    // Forward Space and Undo (preventDefault), leave browser Cmd+R un-prevented.
    const spaceDown = trustedKey("keydown", { key: " ", code: "Space" });
    window.dispatchEvent(spaceDown);
    expect(spaceDown.defaultPrevented).toBe(true);
    window.dispatchEvent(trustedKey("keyup", { key: " ", code: "Space" }));

    const reloadKey = trustedKey("keydown", { key: "r", code: "KeyR", metaKey: true });
    window.dispatchEvent(reloadKey);
    expect(reloadKey.defaultPrevented).toBe(false);

    await vi.waitFor(() => expect(forwarded.length).toBeGreaterThanOrEqual(2));
    expect(forwarded[0]).toMatchObject({ type: "keydown", code: "Space" });
    expect(forwarded[1]).toMatchObject({ type: "keyup", code: "Space" });

    // Start Studio textEdit: Backspace and Enter target the editable element instead of deleting it.
    await ask(port, "text-edit", { handle: hTitle, action: "start", caret: null });
    const titleEl = document.getElementById("title")!;
    titleEl.dispatchEvent(trustedKey("keydown", { key: "Backspace", code: "Backspace" }));
    expect(document.getElementById("title")).not.toBeNull();
    titleEl.dispatchEvent(trustedKey("keydown", { key: "Enter", code: "Enter" }));
    await vi.waitFor(() => expect(ended).toHaveLength(1));
  });

  it("never installs the key shield in same-origin, render, capture, or non-studio pages", () => {
    const spy = vi.spyOn(window, "addEventListener");
    // Same-origin Studio preview: direct inline text editing must stay untouched.
    vi.stubGlobal("origin", "http://localhost:5316");
    markStudio();
    document.body.innerHTML = `<h1 id="title" contenteditable="true">Hi</h1>`;
    installPreviewKeyShield(window, fakeParent);
    expect(spy).not.toHaveBeenCalled();
    const typing = new Event("beforeinput", { bubbles: true, cancelable: true });
    Object.defineProperty(typing, "isTrusted", { value: true });
    document.getElementById("title")!.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);

    // Opaque origin but unmarked page (export/standalone).
    vi.stubGlobal("origin", "null");
    document.head.innerHTML = "";
    installPreviewKeyShield(window, fakeParent);
    expect(spy).not.toHaveBeenCalled();

    // Capture page.
    markStudio(STUDIO_PREVIEW_CAPTURE_MODE);
    installPreviewKeyShield(window, fakeParent);
    expect(spy).not.toHaveBeenCalled();

    // Render mode.
    document.head.innerHTML = "";
    markStudio();
    (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG = {};
    installPreviewKeyShield(window, fakeParent);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
