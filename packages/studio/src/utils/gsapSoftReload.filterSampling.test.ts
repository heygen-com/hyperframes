// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setTimedClipVisibility,
  showHiddenClipFilters,
} from "@hyperframes/core/runtime/timed-clip-hide";
import { applySoftReload } from "./gsapSoftReload";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

type Path = "sync" | "load" | "poll";

function fixture(path: Path, failAt?: string) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  doc.body.innerHTML =
    '<div id="B"></div><script>window.__timelines["root"]=gsap.timeline();</script>';
  const b = doc.getElementById("B")!;
  setTimedClipVisibility(b, "hidden");
  const outside = document.createElement("div");
  document.body.append(outside);
  setTimedClipVisibility(outside, "hidden");
  const observations: { stage: string; borrowed: boolean; visibility: string; decoy: boolean }[] =
    [];
  const record = (stage: string) => {
    observations.push({
      stage,
      borrowed: b.hasAttribute("data-hf-filter-sampling"),
      visibility: b.style.visibility,
      decoy: outside.hasAttribute("data-hf-filter-sampling"),
    });
    if (failAt === stage) throw new Error(`failed ${stage}`);
  };
  Reflect.set(win, "__timelines", { root: { kill: vi.fn() } });
  const timeline = { to: () => timeline, kill: vi.fn() };
  Reflect.set(win, "gsap", { timeline: () => timeline, registerPlugin: () => record("register") });
  Reflect.set(win, "__player", { getTime: () => 0, seek: () => record("seek") });
  Reflect.set(win, "__hfForceTimelineRebind", () => record("finalize"));
  Reflect.set(win, "__hfStudioManualEditsApply", () => record("manual"));
  Reflect.set(win, "MotionPathPlugin", path === "sync" ? {} : undefined);
  Reflect.set(win, "__hfMotionPathPluginLoading", path === "poll");
  let poll: (() => void) | undefined;
  vi.spyOn(win, "setInterval").mockImplementation((callback) => {
    if (typeof callback === "function") poll = () => callback();
    return 17;
  });
  vi.spyOn(win, "clearInterval").mockImplementation(() => {});
  const append = doc.body.appendChild.bind(doc.body);
  vi.spyOn(doc.body, "appendChild").mockImplementation((node) => {
    record("append");
    Reflect.set(win, "__timelines", { root: { kill: vi.fn() } });
    return append(node);
  });
  const runDeferred = () => {
    Reflect.set(win, "MotionPathPlugin", {});
    if (path === "poll") poll?.();
    else {
      const plugin = doc.head.querySelector("script");
      plugin?.onload?.(new Event("load"));
    }
  };
  const script = 'window.__timelines["root"]=gsap.timeline().to("#B",{motionPath:{path:[]}});';
  return { iframe, doc, b, observations, runDeferred, script };
}

describe("soft reload filter sampling", () => {
  it.each(
    (["sync", "load", "poll"] as const).flatMap((path) =>
      [false, true].map((outer) => ({ path, outer })),
    ),
  )("borrows only during $path execution (outer borrow=$outer)", ({ path, outer }) => {
    const { iframe, doc, b, observations, runDeferred, script } = fixture(path);
    const releaseOuter = outer ? showHiddenClipFilters(doc) : () => {};
    expect(applySoftReload(iframe, script)).toBe("applied");
    if (path !== "sync") {
      expect(observations).toEqual([]);
      expect(b.hasAttribute("data-hf-filter-sampling")).toBe(outer);
      runDeferred();
    }
    expect(observations).toEqual(
      ["register", "append", "seek", "finalize", "manual"].map((stage) => ({
        stage,
        borrowed: true,
        visibility: "hidden",
        decoy: false,
      })),
    );
    expect(b.hasAttribute("data-hf-filter-sampling")).toBe(outer);
    releaseOuter();
    expect(b.hasAttribute("data-hf-filter-sampling")).toBe(false);
    expect(b.style.visibility).toBe("hidden");
    expect(b.hasAttribute("data-hf-clip-hidden")).toBe(true);
  });

  it.each(
    (["sync", "load", "poll"] as const).flatMap((path) =>
      ["register", "append", "finalize"].map((stage) => ({ path, stage })),
    ),
  )("releases the borrow after $path $stage throws", ({ path, stage }) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { iframe, doc, b, observations, runDeferred, script } = fixture(path, stage);
    const result = applySoftReload(iframe, script);
    if (path === "sync") expect(result).toBe("cannot-soft-reload");
    else {
      expect(result).toBe("applied");
      expect(() => runDeferred()).toThrow(`failed ${stage}`);
    }
    expect(observations.at(-1)?.borrowed).toBe(true);
    expect(doc.querySelectorAll("[data-hf-filter-sampling]")).toHaveLength(0);
    expect(b.style.visibility).toBe("hidden");
  });
});
