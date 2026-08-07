// @vitest-environment happy-dom
/**
 * What the resize COMMITS, checked as geometry rather than as structure.
 *
 * The structural sweep beside this one proves a resize never addresses a
 * missing animation and never leaves a tween spanning two property groups.
 * Neither says the box ends up the size the user dragged it to, which is the
 * thing they are actually looking at.
 *
 * The invariant is split by who owns the drop point, because the two halves are
 * genuinely different jobs:
 *
 *   - The committed size or scale must reproduce the RENDERED box the user
 *     dropped, whatever rotation is on the element. This is the resize's job in
 *     every route.
 *   - When the resize reports `ownsDragOffset`, the box must also land on the
 *     drop POINT, because it has taken responsibility for the position. When it
 *     does not, position is the drag's job and is not asserted here.
 *
 * Rotation is the reason this exists. The committed scale is worked out from
 * the element's CSS box, and a rotated element's rendered box is not its CSS
 * box — so the two are only equal if the drafted size is in CSS-box terms all
 * the way through. A sweep across rotations is what tells us it is.
 */
import { afterEach, expect, it, vi } from "vitest";
import { classifyTweenPropertyGroup } from "@hyperframes/core/gsap-parser";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { tryGsapResizeIntercept } from "./gsapResizeIntercept";

afterEach(() => {
  vi.restoreAllMocks();
  usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });
  document.body.innerHTML = "";
});

const LAYOUT = { left: 120, top: 520 };

interface Pose {
  box: { w: number; h: number };
  pos: { x: number; y: number };
  scale: { x: number; y: number };
}

/** The AABB a browser reports for `translate() rotate() scale()` about the centre. */
function renderRect(pose: Pose, rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  const [cos, sin] = [Math.abs(Math.cos(rad)), Math.abs(Math.sin(rad))];
  const [sw, sh] = [pose.box.w * pose.scale.x, pose.box.h * pose.scale.y];
  const w = sw * cos + sh * sin;
  const h = sw * sin + sh * cos;
  const cx = LAYOUT.left + pose.box.w / 2 + pose.pos.x;
  const cy = LAYOUT.top + pose.box.h / 2 + pose.pos.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

type Props = Record<string, number>;

function tween(id: string, properties: Props, duration: number): GsapAnimation {
  return {
    id,
    targetSelector: "#el",
    propertyGroup: classifyTweenPropertyGroup(properties),
    method: "to",
    properties,
    position: 0,
    resolvedStart: 0,
    duration,
    ...(duration === 0 ? { extras: { immediateRender: "__raw:true" } } : {}),
  } as unknown as GsapAnimation;
}

interface Case {
  name: string;
  /** The element's untransformed CSS box. */
  box: { w: number; h: number };
  /** Where it sat, and at what scale, before the gesture. */
  base: { x: number; y: number };
  liveScale: { x: number; y: number };
  rotation: number;
  /** The box the user dragged to, and where the draft put it. */
  drop: { w: number; h: number; x: number; y: number };
  animations: () => GsapAnimation[];
}

const ROTATIONS = [0, -8, 45, -47, 90, 180];

/** The routes a resize can take, each as the animations that select it. */
const ROUTES = {
  "scale tween": () => [tween("#el-scale", { scale: 1 }, 2)],
  "scale longhands": () => [tween("#el-scale", { scaleX: 1, scaleY: 1 }, 2)],
  "scale instant hold": () => [tween("#el-scale", { scale: 1 }, 0)],
  "size tween": () => [tween("#el-size", { width: 630, height: 408 }, 2)],
  "size instant hold": () => [tween("#el-size", { width: 630, height: 408 }, 0)],
} as const;

function buildCases(): Case[] {
  const cases: Case[] = [];
  for (const [routeName, animations] of Object.entries(ROUTES)) {
    for (const rotation of ROTATIONS) {
      for (const [dropName, drop] of Object.entries({
        shrink: { w: 326, h: 213, x: 60, y: 40 },
        grow: { w: 980, h: 640, x: -120, y: -90 },
        "near zero": { w: 12, h: 8, x: 200, y: 160 },
        "aspect flip": { w: 900, h: 90, x: 10, y: 10 },
      })) {
        cases.push({
          name: `${routeName} / rotation ${rotation} / ${dropName}`,
          box: { w: 630, h: 408 },
          base: { x: 40, y: 25 },
          liveScale: { x: 1, y: 1 },
          rotation,
          drop,
          animations,
        });
      }
    }
  }
  return cases;
}

const CASES = buildCases();

/** The scale and size the run committed, read at the playhead. */
function committed(calls: unknown[][]) {
  let scale: { x: number; y: number } | null = null;
  let size: { w: number; h: number } | null = null;
  const take = (source: Props | undefined) => {
    if (!source) return;
    const sx = source.scaleX ?? source.scale;
    const sy = source.scaleY ?? source.scale;
    if (sx != null && sy != null) scale = { x: sx, y: sy };
    if (source.width != null && source.height != null) {
      size = { w: source.width, h: source.height };
    }
  };
  for (const call of calls) {
    const mutation = call[1] as {
      properties?: Props;
      percentage?: number;
      keyframes?: Array<{ percentage: number; properties: Props }>;
    };
    if (mutation.keyframes) {
      for (const frame of mutation.keyframes) if (frame.percentage === 0) take(frame.properties);
      continue;
    }
    if (mutation.percentage != null && mutation.percentage !== 0) continue;
    take(mutation.properties);
  }
  return { scale, size };
}

it(`sweeps ${CASES.length} rotations and drops for the box the user dropped`, async () => {
  const failures: string[] = [];

  for (const testCase of CASES) {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    el.id = "el";
    el.setAttribute("data-hf-studio-original-box-width", String(testCase.box.w));
    el.setAttribute("data-hf-studio-original-box-height", String(testCase.box.h));
    el.setAttribute("data-hf-drag-gsap-base-x", String(testCase.base.x));
    el.setAttribute("data-hf-drag-gsap-base-y", String(testCase.base.y));
    el.setAttribute("data-hf-studio-box-size", "true");
    el.style.width = `${testCase.drop.w}px`;
    el.style.height = `${testCase.drop.h}px`;
    document.body.append(el);
    usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });

    const live: Pose = {
      box: { ...testCase.box },
      pos: { x: testCase.drop.x, y: testCase.drop.y },
      scale: { ...testCase.liveScale },
    };
    el.getBoundingClientRect = () => {
      const w = Number.parseFloat(el.style.width) || live.box.w;
      const h = Number.parseFloat(el.style.height) || live.box.h;
      const rect = renderRect({ ...live, box: { w, h } }, testCase.rotation);
      return { ...rect, width: rect.w, height: rect.h } as unknown as DOMRect;
    };
    const gsapStub = {
      set: (_target: Element, vars: Props) => {
        if (vars.x != null) live.pos.x = vars.x;
        if (vars.y != null) live.pos.y = vars.y;
        if (vars.scaleX != null) live.scale.x = vars.scaleX;
        if (vars.scaleY != null) live.scale.y = vars.scaleY;
      },
      getProperty: (_target: Element, prop: string) =>
        ({
          scaleX: live.scale.x,
          scaleY: live.scale.y,
          x: live.pos.x,
          y: live.pos.y,
          rotation: testCase.rotation,
        })[prop] ?? 0,
    };
    Object.assign(window, { gsap: gsapStub });
    const iframe = {
      contentWindow: { gsap: gsapStub, __timelines: { main: { getChildren: () => [] } } },
      contentDocument: document,
    } as unknown as HTMLIFrameElement;

    const dropped = el.getBoundingClientRect();
    const animations = testCase.animations();
    const commitMutation = vi.fn();
    const outcome = await tryGsapResizeIntercept(
      { id: "el", selector: "#el", element: el } as DomEditSelection,
      { width: testCase.drop.w, height: testCase.drop.h },
      animations,
      iframe,
      commitMutation as never,
      async () => animations,
    );

    const { scale, size } = committed(commitMutation.mock.calls);
    const settled = renderRect(
      {
        box: size ?? testCase.box,
        pos: { x: live.pos.x, y: live.pos.y },
        scale: scale ?? testCase.liveScale,
      },
      testCase.rotation,
    );

    // 1px: position rounds to whole pixels and scale to three decimals.
    const off = (a: number, b: number) => Math.abs(a - b) > 1;
    if (off(settled.w, dropped.width) || off(settled.h, dropped.height)) {
      failures.push(
        `${testCase.name} — box ${settled.w.toFixed(1)}x${settled.h.toFixed(1)}` +
          `, dropped ${dropped.width.toFixed(1)}x${dropped.height.toFixed(1)}`,
      );
      continue;
    }
    const ownsDragOffset = outcome.status === "persisted" && outcome.ownsDragOffset === true;
    if (ownsDragOffset && (off(settled.x, dropped.x) || off(settled.y, dropped.y))) {
      failures.push(
        `${testCase.name} — landed ${settled.x.toFixed(1)},${settled.y.toFixed(1)}` +
          ` , dropped ${dropped.x.toFixed(1)},${dropped.y.toFixed(1)}`,
      );
    }
  }

  expect(failures).toEqual([]);
});
