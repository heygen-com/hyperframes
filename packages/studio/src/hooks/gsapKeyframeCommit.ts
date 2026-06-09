import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { absoluteToPercentageForAnimation, findTweenAtTime } from "../utils/globalTimeCompiler";

const PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

type CommitFn = (
  selection: DomEditSelection,
  mutation: Record<string, unknown>,
  options: {
    label: string;
    coalesceKey?: string;
    softReload?: boolean;
    skipReload?: boolean;
  },
) => Promise<void>;

export async function commitKeyframeAtTimeImpl(
  selection: DomEditSelection,
  absoluteTime: number,
  animations: GsapAnimation[],
  properties: Record<string, number | string>,
  commitMutation: CommitFn,
): Promise<void> {
  const selector = selection.id ? `#${selection.id}` : selection.selector;
  if (!selector) return;

  const tween = findTweenAtTime(absoluteTime, animations, selector);
  if (tween) {
    const pct = absoluteToPercentageForAnimation(absoluteTime, tween);
    if (pct === null) return;

    const hasExplicitKeyframes = !!tween.keyframes && tween.keyframes.keyframes.length > 0;
    if (!hasExplicitKeyframes) {
      await commitMutation(
        selection,
        { type: "convert-to-keyframes", animationId: tween.id },
        { label: "Convert to keyframes", skipReload: true },
      );
    }

    const backfillDefaults: Record<string, number | string> = {};
    for (const key of Object.keys(properties)) {
      backfillDefaults[key] = PROPERTY_DEFAULTS[key] ?? 0;
    }

    await commitMutation(
      selection,
      {
        type: "add-keyframe",
        animationId: tween.id,
        percentage: pct,
        properties,
        backfillDefaults,
      },
      {
        label: `Add keyframe at ${Math.round(absoluteTime * 100) / 100}s`,
        coalesceKey: `keyframe:${tween.id}:${pct}`,
        softReload: true,
      },
    );
  } else {
    const defaultDuration = 0.5;
    await commitMutation(
      selection,
      {
        type: "add-with-keyframes" as const,
        targetSelector: selector,
        position: absoluteTime,
        duration: defaultDuration,
        keyframes: [
          { percentage: 0, properties },
          { percentage: 100, properties },
        ],
      },
      {
        label: `New animation at ${Math.round(absoluteTime * 100) / 100}s`,
        softReload: true,
      },
    );
  }
}
