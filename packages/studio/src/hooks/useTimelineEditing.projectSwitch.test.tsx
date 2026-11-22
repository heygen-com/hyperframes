// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { jsonResponse, requestUrl } from "./fetchStubTestUtils";
import { keepUnlessItOverlaps } from "./timelineEditQueue";
import { useTimelineEditing } from "./useTimelineEditing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
  vi.unstubAllGlobals();
});

const clip = (id: string, start: number): TimelineElement => ({
  id,
  key: `index.html#${id}`,
  domId: id,
  tag: "div",
  start,
  duration: 2,
  track: 0,
  sourceFile: "index.html",
});
const SOURCE = ["a", "b", "c", "d"]
  .map(
    (id, i) =>
      `<div id="${id}" data-start="${i * 2}" data-duration="2" data-track-index="0"></div>`,
  )
  .join("\n");

/** Every request to project "new" is a leak; project "old" answers like a server. */
function stubFetch(leaks: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url.includes("/projects/new/")) {
        leaks.push(url);
        return jsonResponse({}, 500);
      }
      if (url.includes("/remove-elements/")) return jsonResponse({ content: SOURCE });
      if (url.includes("/gsap-mutation-capabilities"))
        return jsonResponse({ atomicOwnershipPairs: true });
      if (url.includes("/gsap-mutations")) {
        return jsonResponse({ mutated: false, scriptText: null, before: SOURCE, after: SOURCE });
      }
      if (url.includes("/files/")) return jsonResponse({ content: SOURCE });
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

/** An iframe stand-in that records every way anyone reaches into it, `instanceof` included. */
function spyIframe(touched: string[]): HTMLIFrameElement {
  return new Proxy({} as HTMLIFrameElement, {
    get: (_, property) => {
      touched.push(`get ${String(property)}`);
      return undefined;
    },
    has: (_, property) => {
      touched.push(`has ${String(property)}`);
      return false;
    },
    getPrototypeOf: () => {
      touched.push("getPrototypeOf");
      return null;
    },
  });
}

describe.each(["lands", "is refused"])(
  "edits queued in one project while its first save %s, then a project switch",
  (outcome) => {
    // fails without the fix: the old project's queued edits patched and reloaded the new preview.
    it("never touch the new project's preview, timeline store, files or history", async () => {
      const leaks: string[] = [];
      stubFetch(leaks);
      const store = usePlayerStore.getState();
      store.setRippleEditEnabled(true);
      store.setDuration(10);
      store.setElements([clip("a", 0), clip("b", 2), clip("c", 4), clip("d", 6)]);

      let releaseFirstSave: (error?: Error) => void = () => {};
      const firstSave = new Promise<void>((done, fail) => {
        releaseFirstSave = (error) => (error ? fail(error) : done());
      });
      const oldWrite = vi.fn().mockReturnValueOnce(firstSave).mockResolvedValue(undefined);
      const newProject = { write: vi.fn(), recordEdit: vi.fn() };
      const shared = {
        reloadPreview: vi.fn(),
        forceReloadSdkSession: vi.fn(),
        invalidateGsapCache: vi.fn(),
        pending: { current: new Set<string>() },
      };
      const oldIframe = document.createElement("iframe");
      document.body.append(oldIframe);
      const previewIframeRef: { current: HTMLIFrameElement | null } = { current: oldIframe };

      let hook: ReturnType<typeof useTimelineEditing> | null = null;
      function Harness({ projectId }: { projectId: "old" | "new" }) {
        const own = projectId === "old" ? { write: oldWrite, recordEdit: vi.fn() } : newProject;
        hook = useTimelineEditing({
          projectId,
          activeCompPath: "index.html",
          timelineElements: usePlayerStore.getState().elements,
          showToast: vi.fn(),
          writeProjectFile: own.write,
          recordEdit: own.recordEdit,
          reloadPreview: shared.reloadPreview,
          previewIframeRef,
          pendingTimelineEditPathRef: shared.pending,
          uploadProjectFiles: vi.fn(),
          forceReloadSdkSession: shared.forceReloadSdkSession,
          invalidateGsapCache: shared.invalidateGsapCache,
        });
        return null;
      }
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      act(() => root.render(<Harness projectId="old" />));

      const [a, b, c, d] = usePlayerStore.getState().elements;
      const queued: Array<Promise<unknown>> = [];
      act(() => {
        queued.push(Promise.resolve(hook!.handleTimelineElementsDelete([b!])));
        queued.push(
          Promise.resolve(hook!.handleTimelineElementResize(a!, { start: 0, duration: 1 })),
        );
        queued.push(Promise.resolve(hook!.handleTimelineGroupMove([{ element: c!, start: 7 }])));
        queued.push(Promise.resolve(hook!.handleTimelineElementMove(d!, { start: 9, track: 0 })));
      });

      const touchedIframe: string[] = [];
      const newElements = [clip("x", 0), clip("y", 2)];
      act(() => {
        previewIframeRef.current = spyIframe(touchedIframe);
        usePlayerStore.getState().setElements(newElements);
        root.render(<Harness projectId="new" />);
      });
      for (const spy of Object.values(shared)) if (typeof spy === "function") spy.mockClear();
      shared.pending.current.clear();
      const storeChanges = vi.fn();
      const stopWatching = usePlayerStore.subscribe(storeChanges);

      await act(async () => {
        releaseFirstSave(outcome === "lands" ? undefined : new Error("refused"));
        await Promise.allSettled(queued);
      });
      stopWatching();

      expect(touchedIframe).toEqual([]);
      expect(shared.reloadPreview).not.toHaveBeenCalled();
      expect(shared.forceReloadSdkSession).not.toHaveBeenCalled();
      expect(shared.invalidateGsapCache).not.toHaveBeenCalled();
      expect([...shared.pending.current]).toEqual([]);
      expect(storeChanges).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().elements).toEqual(newElements);
      expect(newProject.write).not.toHaveBeenCalled();
      expect(newProject.recordEdit).not.toHaveBeenCalled();
      expect(leaks).toEqual([]);
      if (outcome === "lands") expect(oldWrite.mock.calls.length).toBeGreaterThan(1);
      act(() => root.unmount());
    });
  },
);

describe.each<
  [string, (hook: ReturnType<typeof useTimelineEditing>, c: TimelineElement) => unknown]
>([
  ["a single-clip drag", (hook, c) => hook.handleTimelineElementMove(c, { start: 2.5, track: 0 })],
  [
    "a group drag, with the policy the move adapter gives it",
    (hook, c) => {
      const changes = [{ element: c, start: 2.5 }];
      return hook.handleTimelineGroupMove(changes, {
        ifEarlierRefused: keepUnlessItOverlaps(changes),
      });
    },
  ],
])("%s queued behind a delete that is refused after a project switch", (_kind, drag) => {
  // fails without the fix: the drag was checked against the shown project's clips, kept, and saved
  // on top of the restored clip in its own project.
  it("is refused with the delete, since its own project's timeline is not shown", async () => {
    stubFetch([]);
    usePlayerStore.getState().setDuration(10);
    usePlayerStore.getState().setElements([clip("a", 0), clip("b", 2), clip("c", 4)]);
    let refuseDelete: (error: Error) => void = () => {};
    const deleteSave = new Promise<void>((_, fail) => (refuseDelete = fail));
    const oldWrite = vi.fn().mockReturnValueOnce(deleteSave).mockResolvedValue(undefined);
    let hook: ReturnType<typeof useTimelineEditing> | null = null;
    function Harness({ projectId }: { projectId: "old" | "new" }) {
      hook = useTimelineEditing({
        projectId,
        activeCompPath: "index.html",
        timelineElements: usePlayerStore.getState().elements,
        showToast: vi.fn(),
        writeProjectFile: projectId === "old" ? oldWrite : vi.fn(),
        recordEdit: vi.fn(),
        reloadPreview: vi.fn(),
        previewIframeRef: { current: null },
        pendingTimelineEditPathRef: { current: new Set<string>() },
        uploadProjectFiles: vi.fn(),
      });
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<Harness projectId="old" />));
    const [, b, c] = usePlayerStore.getState().elements;
    let deleted: Promise<unknown> = Promise.resolve();
    let dragged: Promise<unknown> = Promise.resolve();
    act(() => {
      deleted = Promise.resolve(hook!.handleTimelineElementsDelete([b!]));
      dragged = Promise.resolve(drag(hook!, c!));
    });
    act(() => {
      usePlayerStore.getState().setElements([clip("a", 0)]);
      root.render(<Harness projectId="new" />);
    });

    await act(async () => {
      refuseDelete(new Error("refused"));
      await Promise.allSettled([deleted, dragged]);
    });

    await expect(dragged).rejects.toThrow("refused");
    expect(oldWrite).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
