// @vitest-environment happy-dom
import { gsap } from "gsap";
import { retimeClipTweensInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishTimelineTimingFallback } from "../hooks/timelineTimingSync";
import { applyLiveRetime, planLiveRetime, planLiveRetimeFromPreview } from "./gsapLiveRetime";

const BEFORE = [
  "var tl = gsap.timeline({ paused: true });",
  'tl.set("#b", { y: 3 }, 0.2);',
  'tl.to("#a", { x: 100, duration: 1 }, 0.5);',
  'tl.from("#b", { opacity: 0, duration: 2 }, 1);',
  'tl.to("#c", { keyframes: { "0%": { x: 0 }, "50%": { x: 80 }, "100%": { x: 50 } }, duration: 1.5 }, 2);',
  'window.__timelines["t"] = tl;',
].join("\n");

const SAMPLES = Array.from({ length: 25 }, (_, i) => i * 0.25);

/** Runs a composition script as the preview does, against the elements in the document. */
function play(script: string) {
  const win = { __timelines: {} as Record<string, gsap.core.Timeline> };
  new Function("gsap", "window", script)(gsap, win);
  const timeline = win.__timelines.t!;
  timeline.progress(0.0001, true).seek(0);
  // The runtime nests each sub-composition's timeline into its host's; the script does not know them...
  timeline.add(gsap.timeline().to({}, { duration: 6.7 }), 0);
  // ...and pads the timeline to the composition's length with a filler tween.
  timeline.to({}, { duration: 0, data: "hf-runtime-filler" }, 8);
  return { win, timeline };
}

/** Each tween's start and length, and what every element shows across the timeline. */
function observe(timeline: gsap.core.Timeline) {
  const tweens = timeline
    .getChildren(false, true, false)
    .map((t) => [round(t.startTime()), round(t.duration())]);
  const shown = SAMPLES.map((at) => {
    timeline.seek(at);
    return ["#a", "#b", "#c"].map((id) => [
      round(Number(gsap.getProperty(id, "x"))),
      round(Number(gsap.getProperty(id, "y"))),
      round(Number(gsap.getProperty(id, "opacity"))),
    ]);
  });
  return { tweens, length: round(timeline.duration()), shown };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A preview iframe whose live script is `script`, built and bound. */
function preview(script: string) {
  const tag = document.createElement("script");
  tag.type = "text/plain"; // the runtime already ran it; happy-dom must not run it again
  tag.textContent = script;
  document.body.appendChild(tag);
  const { win, timeline } = play(script);
  const rebind = vi.fn();
  // The runtime hooks a rebind needs; a soft reload would also need `gsap`, which this preview lacks.
  Object.assign(win, { __hfForceTimelineRebind: rebind, __player: { seek: vi.fn() } });
  const iframe = { contentWindow: win, contentDocument: document } as unknown as HTMLIFrameElement;
  return { iframe, timeline, tag, rebind };
}

beforeEach(() => {
  for (const id of ["a", "b", "c"])
    document.body.appendChild(document.createElement("div")).id = id;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const moveA = () =>
  retimeClipTweensInScript(BEFORE, [{ kind: "shift", targetSelector: "#a", delta: 0.75 }], document)
    .script;

async function dropInto(iframe: HTMLIFrameElement, after: string) {
  const reloadPreview = vi.fn();
  await finishTimelineTimingFallback({
    iframe,
    projectId: null,
    reloadPreview,
    gsapMutation: async () => ({ mutated: true, scriptText: after }),
    onGsapError: () => {},
    rebindWhenUnmutated: true,
  });
  return reloadPreview;
}

it("leaves the live preview equal to a fresh load of the saved script after a move and a resize", () => {
  const { script: after } = retimeClipTweensInScript(
    BEFORE,
    [
      { kind: "shift", targetSelector: "#a", delta: 0.75 },
      {
        kind: "scale",
        targetSelector: "#c",
        oldStart: 2,
        oldDuration: 1.5,
        newStart: 2.5,
        newDuration: 3,
      },
    ],
    document,
  );
  const fresh = play(after);
  const want = observe(fresh.timeline);
  fresh.timeline.revert();

  const live = preview(BEFORE);
  const plan = planLiveRetimeFromPreview(live.iframe, after);
  expect(plan.kind).toBe("retime");
  if (plan.kind !== "retime") return;
  expect(plan.tweens.filter((t) => t.moved).map((t) => t.selector)).toEqual(["#a", "#c"]);
  expect(applyLiveRetime(live.iframe, plan)).toBeNull();

  expect(observe(live.timeline)).toEqual(want);
  expect(live.tag.textContent).toBe(after);
});

it("re-runs the script for an edit that changes more than timing", () => {
  const after = BEFORE.replace("x: 100", "x: 140").replace(", 0.5);", ", 0.9);");
  expect(planLiveRetime(BEFORE, after).kind).toBe("rerun");
});

it("re-runs the script when the edit adds a tween", () => {
  const after = BEFORE.replace(
    "window.__timelines",
    'tl.to("#a", { y: 9, duration: 1 }, 4);\nwindow.__timelines',
  );
  expect(planLiveRetime(BEFORE, after).kind).toBe("rerun");
});

it("reports, without moving anything, a live timeline that does not pair with its script", () => {
  // The preview runs a script with one more tween than the text it claims to be running.
  const ran = BEFORE.replace(
    "window.__timelines",
    'tl.to("#b", { x: 5, duration: 1 }, 0);\nwindow.__timelines',
  );
  const live = preview(ran);
  live.tag.textContent = BEFORE;
  const { script: after } = retimeClipTweensInScript(
    BEFORE,
    [{ kind: "shift", targetSelector: "#a", delta: 0.75 }],
    document,
  );
  const plan = planLiveRetimeFromPreview(live.iframe, after);
  expect(plan.kind).toBe("retime");
  if (plan.kind !== "retime") return;
  const starts = live.timeline.getChildren(false, true, false).map((t) => t.startTime());

  expect(applyLiveRetime(live.iframe, plan)).toBe("5 live tweens for 4 in the script");
  expect(live.timeline.getChildren(false, true, false).map((t) => t.startTime())).toEqual(starts);
  expect(live.tag.textContent).toBe(BEFORE);
});

it("syncs a timeline move by moving the live tweens and rebinding, without re-running the script", async () => {
  const live = preview(BEFORE);
  const after = moveA();
  const reloadPreview = await dropInto(live.iframe, after);

  expect(reloadPreview).not.toHaveBeenCalled();
  expect(live.rebind).toHaveBeenCalledTimes(1);
  const got = observe(live.timeline);
  live.timeline.revert();
  expect(got).toEqual(observe(play(after).timeline));
  expect(document.querySelectorAll("script")).toHaveLength(1);
});

it("logs a timing edit whose live tweens do not pair, naming why", async () => {
  const ran = BEFORE.replace(
    "window.__timelines",
    'tl.to("#b", { x: 5, duration: 1 }, 0);\nwindow.__timelines',
  );
  const live = preview(ran);
  live.tag.textContent = BEFORE;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  await dropInto(live.iframe, moveA());

  expect(error).toHaveBeenCalledWith(
    "[timeline] could not move the live tweens for a timing edit: 5 live tweens for 4 in the script",
  );
});

it("pairs by start time, so a second move after a reorder still lands on the right tweens", async () => {
  const live = preview(BEFORE);
  const first = moveA(); // #a now starts after #b, so the live children re-sort
  await dropInto(live.iframe, first);
  const { script: second } = retimeClipTweensInScript(
    first,
    [{ kind: "shift", targetSelector: "#b", delta: 1 }],
    document,
  );
  const error = vi.spyOn(console, "error");

  const reloadPreview = await dropInto(live.iframe, second);

  expect(error).not.toHaveBeenCalled();
  expect(reloadPreview).not.toHaveBeenCalled();
  const got = observe(live.timeline);
  live.timeline.revert();
  expect(got).toEqual(observe(play(second).timeline));
});
