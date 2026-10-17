// @vitest-environment jsdom
import { gsap } from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideTimedClipsUntilFirstPass,
  revealTimedClipsAfterFirstPass,
  setTimedClipVisibility,
  showHiddenClipFilters,
} from "@hyperframes/core/runtime/timed-clip-hide";
import { applyLiveRetime, planLiveRetimeFromPreview } from "./gsapLiveRetime";

afterEach(() => {
  vi.restoreAllMocks();
  gsap.globalTimeline.clear();
  revealTimedClipsAfterFirstPass();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function fixture(failure?: string) {
  hideTimedClipsUntilFirstPass();
  revealTimedClipsAfterFirstPass();
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.head.innerHTML = document.head.innerHTML + "<style>#B { filter: opacity(1) }</style>";
  doc.body.innerHTML = '<div id="B"></div>';
  const b = doc.getElementById("B")!;
  const script = doc.createElement("script");
  script.type = "text/plain";
  const before =
    'var tl=gsap.timeline({paused:true});tl.from("#B",{filter:"opacity(0)",duration:1,immediateRender:false,lazy:false,ease:"none"},2);window.__timelines["root"]=tl;';
  script.textContent = before;
  doc.body.append(script);
  const timeline = gsap
    .timeline({ paused: true })
    .from(
      b,
      { filter: "opacity(0)", duration: 1, immediateRender: false, lazy: false, ease: "none" },
      2,
    );
  timeline.seek(1);
  setTimedClipVisibility(b, "hidden");
  Reflect.set(iframe.contentWindow!, "__timelines", { root: timeline });
  const outside = document.createElement("div");
  document.body.append(outside);
  setTimedClipVisibility(outside, "hidden");
  const after = before.replace("duration:1", "duration:2").replace("},2)", "},0.5)");
  const plan = planLiveRetimeFromPreview(iframe, after);
  if (plan.kind !== "retime") throw new Error("fixture must produce an accepted retime plan");
  const observations: { stage: string; borrowed: boolean; decoy: boolean }[] = [];
  const record = (stage: string) => {
    observations.push({
      stage,
      borrowed: b.hasAttribute("data-hf-filter-sampling"),
      decoy: outside.hasAttribute("data-hf-filter-sampling"),
    });
    if (failure === stage) throw new Error(`failed ${stage}`);
  };
  const remove = timeline.remove.bind(timeline);
  vi.spyOn(timeline, "remove").mockImplementation((child) => {
    record("remove");
    return remove(child);
  });
  const add = timeline.add.bind(timeline);
  vi.spyOn(timeline, "add").mockImplementation((child, position) => {
    record("add");
    return add(child, position);
  });
  const progress = timeline.progress.bind(timeline);
  vi.spyOn(timeline, "progress").mockImplementation((value, suppress) => {
    record("progress");
    return progress(value, suppress);
  });
  const totalTime = timeline.totalTime.bind(timeline);
  vi.spyOn(timeline, "totalTime").mockImplementation((time, suppress) => {
    record("totalTime");
    return totalTime(time, suppress);
  });
  const child = timeline.getChildren()[0]!;
  const duration = child.duration.bind(child);
  vi.spyOn(child, "duration").mockImplementation((...args) => {
    if (args.length > 0) record("duration");
    return Reflect.apply(duration, child, args);
  });
  return { iframe, doc, b, plan, timeline, script, before, after, observations };
}

describe("live retime filter sampling", () => {
  it.each([false, true])("borrows before accepted mutations (outer borrow=%s)", (outer) => {
    const { iframe, doc, b, plan, timeline, script, after, observations } = fixture();
    const releaseOuter = outer ? showHiddenClipFilters(doc) : () => {};
    expect(applyLiveRetime(iframe, plan)).toBe(true);
    expect(script.textContent).toBe(after);
    expect(timeline.time()).toBe(1);
    expect(timeline.progress).toHaveBeenCalledWith(0.0001, true);
    expect(timeline.totalTime).toHaveBeenLastCalledWith(1, false);
    const accepted = observations.slice();
    expect(b.hasAttribute("data-hf-filter-sampling")).toBe(outer);
    releaseOuter();
    setTimedClipVisibility(b, "visible");
    timeline.seek(3);
    expect(doc.defaultView!.getComputedStyle(b).filter).toBe("opacity(1)");
    expect(new Set(accepted.map(({ stage }) => stage))).toEqual(
      new Set(["remove", "duration", "add", "progress", "totalTime"]),
    );
    expect(accepted.every(({ borrowed, decoy }) => borrowed && !decoy)).toBe(true);
    expect(doc.querySelectorAll("[data-hf-filter-sampling]")).toHaveLength(0);
  });

  it.each(["remove", "duration", "add", "progress", "totalTime"])(
    "releases borrowed flags after %s throws",
    (failure) => {
      const { iframe, doc, b, plan, script, before, observations } = fixture(failure);
      expect(() => applyLiveRetime(iframe, plan)).toThrow(`failed ${failure}`);
      expect(observations.at(-1)?.borrowed).toBe(true);
      expect(doc.querySelectorAll("[data-hf-filter-sampling]")).toHaveLength(0);
      expect(b.style.visibility).toBe("hidden");
      expect(b.hasAttribute("data-hf-clip-hidden")).toBe(true);
      expect(script.textContent).toBe(before);
    },
  );

  it("rejects a mismatched live timeline before borrowing or mutating", () => {
    const { iframe, b, plan, observations } = fixture();
    plan.tweens[0]!.wasStart = 99;
    const attributes = [...b.attributes].map(({ name, value }) => [name, value]);
    const setAttribute = vi.spyOn(b, "setAttribute");
    expect(applyLiveRetime(iframe, plan)).toBe(false);
    expect(observations).toEqual([]);
    expect(setAttribute).not.toHaveBeenCalled();
    expect([...b.attributes].map(({ name, value }) => [name, value])).toEqual(attributes);
  });
});
