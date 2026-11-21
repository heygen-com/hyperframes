// @vitest-environment happy-dom
// fails without the fix: all but "still recovers an older script run after an unrelated successful patch" and
// "does not let a re-run sent while a patch's write was in flight cover the patch", which guard the coverage rule.
import { beforeEach, expect, it, vi } from "vitest";

const channel = vi.hoisted(() => ({
  request: vi.fn(),
  load: { id: 1 },
}));
vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewRequest: channel.request,
  previewEditingClient: () => channel.load,
}));
import { applySoftReload } from "./gsapSoftReload";
import { applyUndoRestoreToPreview } from "./gsapUndoRestore";
import { applyPreviewSync } from "../hooks/useGsapScriptCommits";
import { markStudioWriteToken } from "./studioFileVersion";

const iframe = document.createElement("iframe");
const page = (body: string) => `<html><body>${body}</body></html>`;
const script = (x: number) => `window.__timelines["main"] = gsap.timeline().to("#a", { x: ${x} });`;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every request waits until the test answers it, in any order. */
let held: Array<{ kind: string; params: unknown; answer: (reply: unknown) => void }> = [];
beforeEach(() => {
  held = [];
  channel.load = { id: Math.random() };
  channel.request.mockReset();
  channel.request.mockImplementation(
    (_iframe: unknown, kind: string, params: unknown) =>
      new Promise((answer) => held.push({ kind, params, answer })),
  );
});

function rerun(x: number, onAsyncFailure = vi.fn()) {
  applySoftReload(iframe, script(x), {
    currentTimeOverride: 1,
    authoredHtml: page(`<script>${script(x)}</script>`),
    previousHtml: page(""),
    onAsyncFailure,
  });
  return onAsyncFailure;
}

function patch(x: number, reloadPreview = vi.fn()) {
  markStudioWriteToken(`w${x}`);
  const text = script(x);
  const result = {
    ok: true,
    scriptText: text,
    before: page(""),
    after: page(`<script>${text}</script>`),
  };
  const instantPatch = { selector: "#a", change: { kind: "set" as const, props: { x } } };
  applyPreviewSync(
    iframe,
    result,
    { label: "drag", softReload: true, instantPatch },
    reloadPreview,
  );
  return reloadPreview;
}

const reruns = () =>
  held
    .filter(({ kind }) => kind === "soft-reload")
    .map(({ params }) => (params as { script: string }).script);

it("drops an older explicit refusal once a newer re-run of its timeline was sent", async () => {
  const older = rerun(1);
  rerun(2);
  held[0]!.answer({ result: "cannot-soft-reload" });
  await settled();
  expect(older).not.toHaveBeenCalled();
});

it("re-runs the newest saved script when a patch refusal held while a newer patch lands arrives", async () => {
  patch(10);
  patch(20);
  held[1]!.answer({ patched: true });
  held[0]!.answer({ patched: false });
  await settled();
  expect(reruns()).toEqual([script(20)]);
});

it("still recovers an older script run after an unrelated successful patch of its timeline", async () => {
  const older = rerun(1);
  patch(30);
  held[1]!.answer({ patched: true });
  held[0]!.answer({ result: "cannot-soft-reload" });
  await settled();
  expect(older).toHaveBeenCalledOnce();
});

it("still recovers an older script run after an attribute-only undo of its timeline", async () => {
  const older = rerun(1);
  const files = {
    "index.html": {
      previous: page(
        `<div data-hf-id="box" style="left: 9px">t</div><script>${script(1)}</script>`,
      ),
      restored: page(
        `<div data-hf-id="box" style="left: 0px">t</div><script>${script(1)}</script>`,
      ),
    },
  };
  applyUndoRestoreToPreview(iframe, null, files, 2, vi.fn());
  held.find(({ kind }) => kind === "restore-attributes")!.answer({ applied: true, reran: false });
  held[0]!.answer({ result: "cannot-soft-reload" });
  await settled();
  expect(older).toHaveBeenCalledOnce();
});

it("does not let a re-run sent while a patch's write was in flight cover the patch", async () => {
  markStudioWriteToken("in-flight");
  rerun(1);
  patch(40);
  held[1]!.answer({ patched: false });
  await settled();
  expect(reruns()).toEqual([script(1), script(40)]);
});

it("ignores a restore answered after the next load: the new load shows the saved file", async () => {
  const reload = vi.fn();
  const files = {
    "index.html": {
      previous: page(`<div data-hf-id="box" style="left: 9px">t</div>`),
      restored: page(`<div data-hf-id="box" style="left: 0px">t</div>`),
    },
  };
  applyUndoRestoreToPreview(iframe, null, files, 2, reload);
  channel.load = { id: Math.random() };
  held[0]!.answer(null);
  await settled();
  expect(reload).not.toHaveBeenCalled();
});
