// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { sdkTimingPersist, type CutoverResult } from "../utils/sdkCutover";
import { jsonResponse, requestUrl } from "./fetchStubTestUtils";
import { useTimelineEditing } from "./useTimelineEditing";

vi.mock("../utils/sdkCutover", async (original) => ({
  ...(await original<typeof import("../utils/sdkCutover")>()),
  sdkTimingPersist: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const clip = (id: string, start: number): TimelineElement => ({
  id,
  key: `index.html#${id}`,
  domId: id,
  hfId: `hf-${id}`,
  tag: "div",
  start,
  duration: 2,
  track: 0,
  sourceFile: "index.html",
});
const SOURCE = ["a", "b", "c", "x", "y", "z"]
  .map((id) => `<div id="${id}" data-start="0" data-duration="2" data-track-index="0"></div>`)
  .join("\n");

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = requestUrl(input);
      if (url.includes("/gsap-mutation-capabilities")) {
        return jsonResponse({ atomicOwnershipPairs: true });
      }
      if (url.includes("/gsap-mutations")) {
        return jsonResponse({ mutated: false, scriptText: null, before: SOURCE, after: SOURCE });
      }
      return jsonResponse({ content: SOURCE });
    }),
  );
}

type Editing = ReturnType<typeof useTimelineEditing>;
type Elements = Record<"x" | "y" | "z", TimelineElement>;

// Every edit kind this queue touches, made in the newly opened project.
const NEW_PROJECT_EDITS: Array<[string, (hook: Editing, el: Elements) => Promise<unknown>]> = [
  ["a ripple delete", (hook, el) => hook.handleTimelineElementsDelete([el.y])],
  [
    "a ripple trim",
    (hook, el) => hook.handleTimelineElementResize(el.x, { start: 0, duration: 1 }),
  ],
  ["a group move", (hook, el) => hook.handleTimelineGroupMove([{ element: el.z, start: 7 }])],
  [
    "a single-clip move",
    (hook, el) => hook.handleTimelineElementMove(el.z, { start: 7, track: 0 }),
  ],
  [
    "a single-clip trim",
    (hook, el) => hook.handleTimelineElementResize(el.z, { start: 4, duration: 1 }),
  ],
];

describe.each<[string, CutoverResult]>([
  ["the SDK path", { status: "committed", version: "1", before: "<p></p>", after: "<p></p>" }],
  ["the file-write fallback", { status: "declined", reason: "feature_disabled" }],
])("saving through %s", (_path, sdkResult) => {
  describe.each(["lands", "is refused"])(
    "while the old project's ripple delete is held, then %s",
    (outcome) => {
      // fails without the fix: the old project's refusal refused the new project's ripple and trims.
      it.each(NEW_PROJECT_EDITS)(
        "%s in the new project completes and saves, as on main",
        async (_kind, makeEdit) => {
          stubFetch();
          vi.mocked(sdkTimingPersist).mockResolvedValue(sdkResult);
          const store = usePlayerStore.getState();
          store.setRippleEditEnabled(true);
          store.setDuration(20);
          store.setElements([clip("a", 0), clip("b", 2), clip("c", 4)]);

          let releaseOldSave: (error?: Error) => void = () => {};
          const oldSave = new Promise<void>((done, fail) => {
            releaseOldSave = (error) => (error ? fail(error) : done());
          });
          const projects = {
            old: {
              write: vi.fn().mockReturnValueOnce(oldSave).mockResolvedValue(undefined),
              toast: vi.fn(),
            },
            new: { write: vi.fn().mockResolvedValue(undefined), toast: vi.fn() },
          };
          let hook: Editing | null = null;
          function Harness({ projectId }: { projectId: "old" | "new" }) {
            hook = useTimelineEditing({
              projectId,
              activeCompPath: "index.html",
              timelineElements: usePlayerStore.getState().elements,
              showToast: projects[projectId].toast,
              writeProjectFile: projects[projectId].write,
              recordEdit: vi.fn(),
              reloadPreview: vi.fn(),
              previewIframeRef: { current: null },
              pendingTimelineEditPathRef: { current: new Set<string>() },
              uploadProjectFiles: vi.fn(),
              sdkSession: { getElement: () => null } as never,
            });
            return null;
          }
          const host = document.createElement("div");
          document.body.append(host);
          const root = createRoot(host);
          act(() => root.render(<Harness projectId="old" />));
          const oldDelete = hook!.handleTimelineElementsDelete([
            usePlayerStore.getState().elements[1]!,
          ]);

          const el = { x: clip("x", 0), y: clip("y", 2), z: clip("z", 4) };
          act(() => {
            usePlayerStore.getState().setElements([el.x, el.y, el.z]);
            root.render(<Harness projectId="new" />);
          });
          vi.mocked(sdkTimingPersist).mockClear();
          let newEdit: Promise<unknown> = Promise.resolve();
          act(() => {
            newEdit = Promise.resolve(makeEdit(hook!, el));
          });

          await act(async () => {
            releaseOldSave(outcome === "lands" ? undefined : new Error("refused"));
            await oldDelete;
            await newEdit;
          });

          const saves =
            projects.new.write.mock.calls.length + vi.mocked(sdkTimingPersist).mock.calls.length;
          expect(saves).toBeGreaterThan(0);
          expect(projects.new.toast.mock.calls.filter(([, tone]) => tone !== "info")).toEqual([]);
          act(() => root.unmount());
        },
      );
    },
  );
});
