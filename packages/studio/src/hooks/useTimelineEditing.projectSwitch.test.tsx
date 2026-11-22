// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { jsonResponse, requestUrl } from "./fetchStubTestUtils";
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
const SOURCE = ["a", "b", "c"]
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
      if (url.includes("/gsap-mutation-capabilities")) return jsonResponse({});
      if (url.includes("/gsap-mutations")) {
        return jsonResponse({ mutated: false, scriptText: null, before: SOURCE, after: SOURCE });
      }
      if (url.includes("/files/")) return jsonResponse({ content: SOURCE });
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

/** An iframe stand-in that records every property anyone reads from it. */
function spyIframe(touched: string[]): HTMLIFrameElement {
  return new Proxy({} as HTMLIFrameElement, {
    get: (_, property) => {
      touched.push(String(property));
      return undefined;
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
      store.setElements([clip("a", 0), clip("b", 2), clip("c", 4)]);

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

      const [a, b, c] = usePlayerStore.getState().elements;
      const queued: Array<Promise<unknown>> = [];
      act(() => {
        queued.push(Promise.resolve(hook!.handleTimelineElementsDelete([b!])));
        queued.push(
          Promise.resolve(hook!.handleTimelineElementResize(a!, { start: 0, duration: 1 })),
        );
        queued.push(Promise.resolve(hook!.handleTimelineGroupMove([{ element: c!, start: 7 }])));
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
