// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { liveTween, previewWith, tween } from "../../hooks/gsapParsedTween.test-helpers";
import { usePlayerStore } from "../../player/store/playerStore";
import { commitNodeDrop } from "./motionPathCommit";

afterEach(() => {
  usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });
  document.body.innerHTML = "";
});

it("a keyframe node's drop changes that keyframe and keeps a newly animated channel on the others", async () => {
  const el = document.createElement("div");
  el.id = "box";
  document.body.append(el);
  const selection = { id: "box", selector: "#box", element: el } as DomEditSelection;
  // keyframes: [{ x: 60, duration: 2 }, { x: 120, duration: 1 }], over a CSS translate GSAP read as y 30.
  const keys = tween({
    id: "#box-to-0-position",
    method: "to",
    properties: {},
    resolvedStart: 0,
    duration: 3,
    keyframes: {
      format: "object-array",
      keyframes: [
        { percentage: 66.7, properties: { x: 60 } },
        { percentage: 100, properties: { x: 120 } },
      ],
    },
  });
  const steps = [
    { startTime: () => 0, duration: () => 2 },
    { startTime: () => 2, duration: () => 1 },
  ];
  const live = liveTween(el, { start: 0, duration: 3, vars: { keyframes: [] } }, { parts: steps });
  const iframe = previewWith(el, [live], { x: 60, y: 30 });
  usePlayerStore.setState({ currentTime: 2, autoKeyframeEnabled: true });
  const commitMutation = vi.fn(async () => {});

  await commitNodeDrop({
    ref: { type: "keyframe", pct: 100 },
    at: { x: 150, y: 90 },
    animId: keys.id,
    anim: keys,
    selection,
    iframe,
    commitMutation,
  });

  const [mutation] = commitMutation.mock.calls.map((call) => call[0] as Record<string, never>);
  expect(mutation!.type).toBe("replace-with-keyframes");
  expect((mutation!.keyframes as { properties: object }[]).map((kf) => kf.properties)).toEqual([
    { x: 60, y: 30 },
    { x: 150, y: 90 },
  ]);
});
