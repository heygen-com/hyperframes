// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDomGeometryCommit,
  usePlayerStore,
  type DomEditOverlayProps,
  type UseDomGeometryCommitOptions,
} from "../index";
import { makeSelection } from "./domSelectionTestHarness";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const SOURCE = '<div id="card">Card</div><div id="other">Other</div>';

/** A warm parse where only another element animates, and a GSAP writer answering `status`. */
function stubServer(status = 200, parseStatus = 200) {
  const mutations: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown, code = 200) =>
        new Response(JSON.stringify(body), {
          status: code,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("/api/projects/p1/gsap-animations/")) {
        if (parseStatus !== 200) return json({ error: "down" }, parseStatus);
        return json({
          animations: [
            {
              id: "other-fade",
              targetSelector: "#other",
              method: "to",
              position: 0,
              duration: 1,
              properties: { opacity: 1 },
              propertyGroup: "opacity",
            },
          ],
        });
      }
      if (url.includes("/api/projects/p1/gsap-mutations/")) {
        mutations.push(JSON.parse(String(init?.body)));
        if (status !== 200) return json({ error: "refused" }, status);
        return json({ ok: true, changed: true, before: "BEFORE", after: "AFTER" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  return mutations;
}

function renderHost(options: Partial<UseDomGeometryCommitOptions> = {}) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe document");
  doc.body.innerHTML = SOURCE;
  const element = doc.getElementById("card") as HTMLElement;
  const recordEdit = vi.fn(async () => {});
  const writeProjectFile = vi.fn(async () => {});
  const reloadPreview = vi.fn();
  const api: { current: ReturnType<typeof useDomGeometryCommit> | null } = { current: null };
  function Host() {
    const iframeRef = useRef<HTMLIFrameElement | null>(iframe);
    api.current = useDomGeometryCommit({
      projectId: "p1",
      iframeRef,
      writeProjectFile,
      recordEdit,
      reloadPreview,
      ...options,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  const hook = () => {
    if (!api.current) throw new Error("Expected the hook to render");
    return api.current;
  };
  return {
    element,
    recordEdit,
    hook,
    rerender: () => act(() => root.render(createElement(Host))),
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  usePlayerStore.setState({ previewBooted: true, timelineProjectId: "p1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useDomGeometryCommit, from the package entry", () => {
  it("plugs into DomEditOverlay and saves a move as one GSAP write and one undo step", async () => {
    const mutations = stubServer();
    const { element, recordEdit, hook, unmount } = renderHost();
    const overlayCommits: Pick<
      DomEditOverlayProps,
      "onPathOffsetCommit" | "onGroupPathOffsetCommit" | "onBoxSizeCommit" | "onRotationCommit"
    > = {
      onPathOffsetCommit: hook().commitPathOffset,
      onGroupPathOffsetCommit: hook().commitGroupPathOffset,
      onBoxSizeCommit: hook().commitBoxSize,
      onRotationCommit: hook().commitRotation,
    };

    const outcome = await overlayCommits.onPathOffsetCommit(makeSelection("card", element), {
      x: 40,
      y: 20,
    });

    expect(outcome).toEqual({ ok: true });
    expect(mutations).toEqual([
      expect.objectContaining({ type: "add", targetSelector: "#card", method: "set" }),
    ]);
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({ files: { "index.html": { before: "BEFORE", after: "AFTER" } } }),
    );
    unmount();
  });

  it("keeps the same commits across renders, so the overlay's handlers stay put", () => {
    stubServer();
    const { hook, rerender, unmount } = renderHost();
    const first = hook();
    rerender();
    expect(hook().commitPathOffset).toBe(first.commitPathOffset);
    expect(hook().commitRotation).toBe(first.commitRotation);
    unmount();
  });

  it("rejects a move the server refuses, so the overlay undoes it", async () => {
    stubServer(500);
    const showToast = vi.fn();
    const { element, recordEdit, hook, unmount } = renderHost({ showToast });

    await expect(
      hook().commitPathOffset(makeSelection("card", element), { x: 40, y: 20 }),
    ).rejects.toThrow();
    expect(recordEdit).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    unmount();
  });

  it("undoes a resize whose animations cannot be read, and saves nothing", async () => {
    const mutations = stubServer(200, 500);
    const showToast = vi.fn();
    const restore = vi.fn();
    const { element, recordEdit, hook, unmount } = renderHost({ showToast });

    await expect(
      hook().commitBoxSize(
        makeSelection("card", element),
        { width: 300, height: 90 },
        undefined,
        restore,
      ),
    ).rejects.toThrow();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    expect(mutations).toHaveLength(0);
    expect(recordEdit).not.toHaveBeenCalled();
    unmount();
  });

  it.each([
    ["the player shows another project", { timelineProjectId: "another-project" }],
    ["the preview has not booted", { previewBooted: false }],
  ])("refuses at once when %s", async (_state, store) => {
    const mutations = stubServer();
    usePlayerStore.setState(store);
    const restore = vi.fn();
    const showToast = vi.fn();
    const { element, hook, unmount } = renderHost({ showToast });

    await expect(
      hook().commitBoxSize(
        makeSelection("card", element),
        { width: 300, height: 90 },
        undefined,
        restore,
      ),
    ).rejects.toThrow("has not loaded yet");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("not loaded"), "error");
    expect(mutations).toHaveLength(0);
    unmount();
  });

  it("waits for a move still being saved", async () => {
    const mutations = stubServer();
    const { element, recordEdit, hook, unmount } = renderHost();

    const move = hook().commitPathOffset(makeSelection("card", element), { x: 40, y: 20 });
    await hook().waitForPendingSaves();

    expect(mutations).toHaveLength(1);
    expect(recordEdit).toHaveBeenCalledTimes(1);
    await move;
    unmount();
  });

  it("rejects without a project and writes nothing", async () => {
    const mutations = stubServer();
    const { element, hook, unmount } = renderHost({ projectId: null });

    await expect(
      hook().commitRotation(makeSelection("card", element), { angle: 15 }),
    ).rejects.toThrow("No project is open");
    expect(mutations).toHaveLength(0);
    unmount();
  });
});

describe("useDomGeometryCommit, one word of a staggered phrase", () => {
  const WORDS = ["How", "we", "build", "videos", "at", "scale", "every", "day"];
  const PHRASE = WORDS.map((w, i) => `<span class="w" data-hf-id="hf-w${i}">${w}</span>`).join("");

  function stubPhraseServer() {
    const calls = { patches: [] as unknown[], gsapMutations: [] as unknown[] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
        if (url.includes("/api/projects/p1/gsap-animations/")) {
          return json({
            animations: [
              {
                id: ".w-from-200",
                targetSelector: ".w",
                method: "from",
                position: 0.2,
                duration: 0.6,
                properties: { y: 60, opacity: 0 },
              },
            ],
          });
        }
        if (url.includes("/api/projects/p1/files/")) return json({ content: PHRASE });
        if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
          calls.patches.push(JSON.parse(String(init?.body)));
          return json({ ok: true, changed: true, matched: true, content: "AFTER", version: "v2" });
        }
        if (url.includes("/api/projects/p1/gsap-mutations/")) {
          calls.gsapMutations.push(JSON.parse(String(init?.body)));
          return json({ ok: true, changed: true, before: "B", after: "A" });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    return calls;
  }

  it("saves left/top on the dragged word only and never rewrites the shared tween", async () => {
    const calls = stubPhraseServer();
    const { element, recordEdit, hook, unmount } = renderHost();
    element.ownerDocument.body.innerHTML = PHRASE;
    const word = element.ownerDocument.querySelector<HTMLElement>('[data-hf-id="hf-w0"]')!;
    Object.defineProperties(word, {
      offsetLeft: { get: () => 100 + (Number.parseFloat(word.style.left) || 0) },
      offsetTop: { get: () => 200 + (Number.parseFloat(word.style.top) || 0) },
    });
    const selection = {
      ...makeSelection("How", word),
      id: undefined,
      selector: ".w",
      selectorIndex: 0,
      hfId: "hf-w0",
    };

    await expect(hook().commitPathOffset(selection, { x: 40, y: 20 })).resolves.toEqual({
      ok: true,
    });

    expect(calls.gsapMutations).toHaveLength(0);
    expect(calls.patches).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ hfId: "hf-w0" }),
        operations: [
          { type: "inline-style", property: "position", value: "relative" },
          { type: "inline-style", property: "left", value: "40px" },
          { type: "inline-style", property: "top", value: "20px" },
        ],
      }),
    ]);
    expect(recordEdit).toHaveBeenCalledTimes(1);
    unmount();
  });
});
