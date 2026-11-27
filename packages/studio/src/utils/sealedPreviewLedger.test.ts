// @vitest-environment happy-dom
// fails without the fix: all but "still recovers an older script run after an unrelated successful patch" and
// "does not let a re-run sent while a patch's write was in flight cover the patch", which guard the coverage rule.
import { beforeEach, describe, expect, it, vi } from "vitest";

const channel = vi.hoisted(() => ({
  request: vi.fn(),
  load: { id: 1 },
}));
vi.mock("../player/lib/previewChannel", async (importOriginal) => {
  const original = await importOriginal<typeof import("../player/lib/previewChannel")>();
  const { admittedAnswer } = await import("../../tests/previewAnswerMock");
  return {
    ...original,
    previewFrameOpaque: () => true,
    previewRequest: channel.request,
    previewAnswer: admittedAnswer(channel.request, original.PREVIEW_STALE),
    previewEditingClient: () => channel.load,
  };
});
import { applySoftReload } from "./gsapSoftReload";
import { applyUndoRestoreToPreview } from "./gsapUndoRestore";
import { applyPreviewSync } from "../hooks/useGsapScriptCommits";
import { moveLiveTweens } from "./gsapLiveRetime";
import { markStudioWriteToken } from "./studioFileVersion";
import { previewLoadShows } from "./sealedPreviewLedger";

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

it("still recovers an older script run that times out after an attribute-only undo of its timeline", async () => {
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
  held[0]!.answer(null);
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

// fails without the fix: the recovery re-ran the retime's script without its saved clip timing.
it("re-runs a refused patch's recovery with the timing of a live retime saved after it", async () => {
  const retimed = (d: number) =>
    `window.__timelines["main"] = gsap.timeline().to("#a", { x: 10, duration: ${d} }, 0);`;
  const file = (start: number, d: number) =>
    page(`<div id="a" data-hf-id="a" data-start="${start}"></div><script>${retimed(d)}</script>`);
  markStudioWriteToken("patch");
  const patched = { ok: true, scriptText: retimed(1), before: file(0, 1), after: file(0, 1) };
  const instantPatch = { selector: "#a", change: { kind: "set" as const, props: { x: 10 } } };
  applyPreviewSync(iframe, patched, { label: "drag", softReload: true, instantPatch }, vi.fn());
  markStudioWriteToken("retime");
  void moveLiveTweens(iframe, retimed(2), 1, vi.fn(), { before: file(0, 1), after: file(1, 2) });
  await settled();
  expect(held.map(({ kind }) => kind)).toEqual(["patch-tweens", "live-retime"]);
  held[0]!.answer({ patched: false });
  await settled();
  const rerun = held.find(({ kind }) => kind === "soft-reload")!.params as { timing: unknown[] };
  expect(rerun.timing).toContainEqual(["hf:a", [["data-start", "1"]]]);
});

// fails without the fix: the older retime went out and put its file's clip timing over the newer file's.
describe("an older live retime whose preview sync goes out after a newer file's", () => {
  const retimed = (d: number) =>
    `window.__timelines["main"] = gsap.timeline().to("#a", { x: 10, duration: ${d} }, 0);`;
  const file = (start: number, d: number, b = 0) =>
    page(
      `<div id="a" data-hf-id="a" data-start="${start}"></div><div data-hf-id="b" data-start="${b}"></div>` +
        `<script>${retimed(d)}</script>`,
    );
  const kinds = () => held.map(({ kind }) => kind);

  it("is not sent, and re-runs the newer file in place", async () => {
    const reload = vi.fn();
    applySoftReload(iframe, retimed(3), {
      currentTimeOverride: 1,
      authoredHtml: file(1, 3),
      previousHtml: file(1, 2),
      version: 5,
    });
    await settled();
    await moveLiveTweens(iframe, retimed(2), 1, reload, {
      before: file(0, 1),
      after: file(1, 2),
      revision: 4,
    });
    await settled();
    expect(kinds()).toEqual(["soft-reload", "soft-reload"]);
    const recovery = held[1]!.params as { script: string; timing: unknown[] };
    expect(recovery.script).toBe(retimed(3));
    expect(recovery.timing).toContainEqual(["hf:a", [["data-start", "1"]]]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("is not sent after a newer undo of another clip, and re-runs the undone file in place", async () => {
    const reload = vi.fn();
    const undo = { "index.html": { previous: file(1, 2, 0), restored: file(1, 2, 1) } };
    applyUndoRestoreToPreview(iframe, null, undo, 1, vi.fn(), undefined, 5);
    await settled();
    await moveLiveTweens(iframe, retimed(2), 1, reload, {
      before: file(0, 1),
      after: file(1, 2),
      revision: 4,
    });
    await settled();
    expect(kinds()).toEqual(["restore-attributes", "soft-reload"]);
    const recovery = held[1]!.params as { timing: unknown[] };
    expect(recovery.timing).toContainEqual(["hf:b", [["data-start", "1"]]]);
    expect(recovery.timing).toContainEqual(["hf:a", [["data-start", "1"]]]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("is not sent to a new load showing a newer saved file, and reloads it", async () => {
    channel.load = { id: Math.random() };
    previewLoadShows(iframe, 5);
    const reload = vi.fn();
    await moveLiveTweens(iframe, retimed(2), 1, reload, {
      before: file(0, 1),
      after: file(1, 2),
      revision: 4,
    });
    await settled();
    expect(kinds()).toEqual([]);
    expect(reload).toHaveBeenCalledOnce();
  });
});
