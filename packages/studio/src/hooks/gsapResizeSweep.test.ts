// @vitest-environment happy-dom
/**
 * Every shape of animated element a composition can hand the resize, swept.
 *
 * Both faults this branch fixes were found one composition at a time, which is
 * a bad way to find the third. So this drives the real intercept across the
 * cross-product of what an element's tweens can look like and holds every run
 * to the two rules that were broken:
 *
 *   1. Never address an animation the source does not have. Sending a stale id
 *      is what "animation not found" is, and it leaves the element unsavable.
 *   2. Never leave a tween spanning two property groups. The parser classifies
 *      such a tween as neither, so it loses its group suffix and its id along
 *      with it, and every later edit has nothing to address.
 *
 * The server stand-in answers the way the real one does — an id it cannot find
 * is a rejection — and applies what it is told, so a run that corrupts the
 * animation list is caught by the next mutation in the same run rather than by
 * a person noticing weeks later.
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

/** The dimensions an element's animations actually vary across. */
const SCALE = {
  none: null,
  "instant hold": () => tween("#el-scale", { scale: 1.2 }, 0),
  tween: () => tween("#el-scale", { scale: 1.2 }, 2),
  longhands: () => tween("#el-scale", { scaleX: 1.2, scaleY: 1.1 }, 2),
} as const;
const SIZE = {
  none: null,
  "instant hold": () => tween("#el-size", { width: 300, height: 200 }, 0),
  tween: () => tween("#el-size", { width: 300, height: 200 }, 2),
} as const;
const POSITION = {
  none: null,
  "static hold": () => tween("#el-position", { x: 40, y: 60 }, 0),
  tween: () => tween("#el-position", { x: 40, y: 60 }, 2),
} as const;
const EXTRA = {
  none: null,
  // What a 3D card carries, and the shape that produced two same-group ids.
  "3d and rotation": () => [
    tween("#el-other", { rotationY: -540, rotationX: 720, _auto: 0 }, 0),
    tween("#el-rotation", { rotation: 720 }, 0),
    tween("#el-other-2", { z: 50 }, 0),
  ],
  // A tween that already spans two groups, which the resize has to split.
  "a mixed tween": () => [tween("#el-mixed", { scale: 1.2, width: 300, height: 200 }, 0)],
} as const;

interface Recorded {
  rejected: string[];
  corrupted: string[];
}

/**
 * The source, as the server sees it: a list of animations, a rejection for an
 * id that is not in it, and the effect of each mutation applied.
 */
function fakeSource(initial: GsapAnimation[]) {
  let current = initial;
  const recorded: Recorded = { rejected: [], corrupted: [] };

  const mergeInto = (id: string, properties: Props) => {
    current = current.map((animation) => {
      if (animation.id !== id) return animation;
      const before = classifyTweenPropertyGroup(animation.properties ?? {});
      const merged = { ...(animation.properties ?? {}), ...properties };
      const after = classifyTweenPropertyGroup(merged);
      // Mixing is only a fault when the resize CAUSED it. A tween that already
      // spanned two groups is an input, and splitting it is the point.
      if (before !== undefined && after === undefined) recorded.corrupted.push(id);
      return { ...animation, properties: merged, propertyGroup: after } as GsapAnimation;
    });
  };

  const split = (id: string) => {
    const target = current.find((animation) => animation.id === id);
    if (!target) return;
    const byGroup = new Map<string, Props>();
    for (const [key, value] of Object.entries(target.properties ?? {})) {
      const group = classifyTweenPropertyGroup({ [key]: value as number }) ?? "other";
      byGroup.set(group, { ...(byGroup.get(group) ?? {}), [key]: value as number });
    }
    current = [
      ...current.filter((animation) => animation.id !== id),
      ...[...byGroup].map(([group, properties]) =>
        tween(`#el-split-${group}`, properties, target.duration ?? 0),
      ),
    ];
  };

  const commitMutation = vi.fn(async (_selection: unknown, mutation: Record<string, unknown>) => {
    const id = mutation.animationId as string | undefined;
    if (id && !current.some((animation) => animation.id === id)) {
      recorded.rejected.push(`${String(mutation.type)}:${id}`);
      throw new Error("animation not found");
    }
    const properties = (mutation.properties ?? {}) as Props;
    const framed = (mutation.keyframes as Array<{ properties: Props }> | undefined) ?? [];
    if (mutation.type === "split-into-property-groups" && id) split(id);
    else if (id) {
      mergeInto(id, properties);
      for (const frame of framed) mergeInto(id, frame.properties);
    } else if (mutation.type === "add") {
      current = [...current, tween(`#el-added-${current.length}`, properties, 0)];
    }
  });

  return { commitMutation, recorded, animations: () => current };
}

function buildCases() {
  const cases: Array<{ name: string; animations: GsapAnimation[] }> = [];
  for (const [scaleName, scale] of Object.entries(SCALE)) {
    for (const [sizeName, size] of Object.entries(SIZE)) {
      for (const [positionName, position] of Object.entries(POSITION)) {
        for (const [extraName, extra] of Object.entries(EXTRA)) {
          const animations = [
            ...(scale ? [scale()] : []),
            ...(size ? [size()] : []),
            ...(position ? [position()] : []),
            ...(extra ? extra() : []),
          ];
          cases.push({
            name: `scale ${scaleName} / size ${sizeName} / position ${positionName} / ${extraName}`,
            animations,
          });
        }
      }
    }
  }
  return cases;
}

const CASES = buildCases();

it(`sweeps ${CASES.length} animated shapes without a stale id or a mixed tween`, async () => {
  const failures: string[] = [];

  for (const testCase of CASES) {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    el.id = "el";
    el.setAttribute("data-hf-studio-original-box-width", "630");
    el.setAttribute("data-hf-studio-original-box-height", "408");
    document.body.append(el);
    usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });

    const source = fakeSource(testCase.animations);
    try {
      await tryGsapResizeIntercept(
        { id: "el", selector: "#el", element: el } as DomEditSelection,
        { width: 326, height: 213 },
        testCase.animations,
        null,
        source.commitMutation as never,
        async () => source.animations(),
      );
    } catch (error) {
      // A rejection is recorded below; anything else is worth reporting as-is.
      if (!(error instanceof Error) || error.message !== "animation not found") {
        failures.push(`${testCase.name} — threw ${String(error)}`);
      }
    }

    if (source.recorded.rejected.length > 0) {
      failures.push(`${testCase.name} — stale id: ${source.recorded.rejected.join(", ")}`);
    }
    if (source.recorded.corrupted.length > 0) {
      failures.push(`${testCase.name} — mixed tween: ${source.recorded.corrupted.join(", ")}`);
    }
  }

  expect(failures).toEqual([]);
});
