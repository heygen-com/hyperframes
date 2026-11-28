import type { DomEditPersistOutcome } from "../../hooks/domEditCommitTypes";
import type { PatchOperation } from "../../utils/sourcePatcher";
import type { CommitMutation } from "../../hooks/gsapScriptCommitTypes";
import type { GsapEditOutcome } from "../../hooks/gsapEditOutcome";
import { roundToLayoutSize } from "../../utils/rounding";
import type { DomEditSelection } from "./domEditingTypes";
import { elementHasNonHoldTween, gsapWritesChannels } from "../../hooks/gsapRuntimeKeyframes";
import { buildInsetClipPathSides, type ParsedInsetClipPathSides } from "./clipPathHelpers";
import { hasCropInsets, readElementCropInsets } from "./domEditOverlayCrop";
import {
  forgetStudioBoxSizeDraftBase,
  layoutBox,
  readStudioBoxSize,
  readStudioBoxSizeDraftBase,
  type LayoutBox,
} from "./manualEditsDom";
import { previewStandInHandle } from "./previewDrafts";
import { sealedResizeStartBox } from "./resizeStartBox";

interface Box {
  width: number;
  height: number;
}

const boxOf = (element: HTMLElement): Box => ({
  width: element.offsetWidth,
  height: element.offsetHeight,
});

type Follows = Record<keyof Box, boolean>;

const laidOut = (value: number | undefined) => (value && value > 0 ? value : undefined);

/** An open element's own box; a sealed stand-in has none, so the size this resize wrote over `from`. */
function landedBox(element: HTMLElement, from: Box, sized: Partial<Box> | null): Box {
  if (!previewStandInHandle(element)) return boxOf(element);
  return {
    width: laidOut(sized?.width) ?? from.width,
    height: laidOut(sized?.height) ?? from.height,
  };
}

/** Per axis, whether a crop follows a resize: not when GSAP drives the clip or tweens that axis's size. */
function cropFollows(element: HTMLElement): Follows {
  const clip = gsapWritesChannels(element, ["clipPath"]);
  return {
    width: !clip && !elementHasNonHoldTween(element, ["width"]),
    height: !clip && !elementHasNonHoldTween(element, ["height"]),
  };
}

function scaleCrop(
  crop: ParsedInsetClipPathSides,
  from: Box,
  to: Box,
  follows: Follows,
): ParsedInsetClipPathSides {
  const sx = follows.width && from.width > 0 ? to.width / from.width : 1;
  const sy = follows.height && from.height > 0 ? to.height / from.height : 1;
  return {
    top: crop.top * sy,
    right: crop.right * sx,
    bottom: crop.bottom * sy,
    left: crop.left * sx,
    radius: crop.radius,
  };
}

/** The element's crop as the crop UI draws it: it follows the box while a resize draft is live. */
export function readCropFollowingResize(element: HTMLElement): ParsedInsetClipPathSides | null {
  const crop = readElementCropInsets(element);
  const base = readStudioBoxSizeDraftBase(element);
  if (!crop || !base) return crop;
  return scaleCrop(
    crop,
    base,
    landedBox(element, base, readStudioBoxSize(element)),
    cropFollows(element),
  );
}

export interface CropResize {
  patch: PatchOperation;
  revert: () => void;
}

/** The size a GSAP resize laid the box out at; none when it saved a scale, which keeps the box. */
export const gsapResizeLaidOut = (outcome: GsapEditOutcome, next: Box) =>
  outcome.status === "persisted" && outcome.savedAsScale ? null : roundToLayoutSize(next);

export type CropStage = ((sized?: Partial<Box> | null) => CropResize | null) & {
  ready?: Promise<void>;
};

/** Call before a resize lands. Once the new size is live, the stage writes the crop that keeps the
 *  same part of the element in view and returns its patch, or null when nothing needs rescaling. */
export function prepareCropResize(
  element: HTMLElement,
  startBox: LayoutBox | null | Promise<LayoutBox | null> = null,
): CropStage {
  const base = readStudioBoxSizeDraftBase(element);
  let from = base ?? layoutBox(element, startBox instanceof Promise ? null : startBox);
  const ready =
    !base && startBox instanceof Promise
      ? startBox.then((box) => void (from = layoutBox(element, box)))
      : undefined;
  const before = element.style.getPropertyValue("clip-path");
  const priority = element.style.getPropertyPriority("clip-path");
  // Decided before the write lands: a W edit may add a width keyframe of its own.
  const follows = cropFollows(element);
  const crop = readElementCropInsets(element);
  const stage = (sized: Partial<Box> | null = null): CropResize | null => {
    forgetStudioBoxSizeDraftBase(element);
    const to = landedBox(element, from, sized);
    // A crop edited while the size saved was drawn in the new box already.
    const untouched = element.style.getPropertyValue("clip-path") === before;
    if (!crop || !hasCropInsets(crop) || !untouched || !(to.width > 0 && to.height > 0))
      return null;
    const clip = buildInsetClipPathSides(scaleCrop(crop, from, to, follows), crop.radius);
    // Unchanged when the box is (a resize saved as a `scale`) or no resized axis follows.
    if (clip === buildInsetClipPathSides(crop, crop.radius)) return null;
    element.style.setProperty("clip-path", clip, priority);
    return {
      patch: {
        type: "inline-style",
        property: "clip-path",
        value: priority ? `${clip} !important` : clip,
      },
      revert: () => {
        if (before) element.style.setProperty("clip-path", before, priority);
        else element.style.removeProperty("clip-path");
      },
    };
  };
  return Object.assign(stage, { ready });
}

type PatchCommit = (
  selection: DomEditSelection,
  patches: PatchOperation[],
  options: { label: string; coalesceKey: string; coalesceMs?: number },
) => Promise<DomEditPersistOutcome | undefined>;

/** Stage the crop and save it under the resize's undo key, taking it back off the element if that fails. */
export async function saveCropResize(
  stage: CropStage,
  selection: DomEditSelection,
  commit: PatchCommit,
  coalesceKey: string,
  sized: Partial<Box> | null = null,
): Promise<DomEditPersistOutcome | undefined> {
  if (stage.ready) await stage.ready;
  const crop = stage(sized);
  if (!crop) return;
  try {
    return await commit(selection, [crop.patch], {
      label: "Resize layer",
      coalesceKey,
      coalesceMs: Number.POSITIVE_INFINITY,
    });
  } catch (error) {
    crop.revert();
    throw error;
  }
}

let sizeWriteCounter = 0;

/** A property write that may size the element (a W/H field on an animated element): when it
 *  does, its writes and the rescaled crop share one undo step. */
export async function writeSizeWithCrop(
  selection: DomEditSelection,
  properties: Record<string, unknown>,
  mutation: CommitMutation | null,
  commit: PatchCommit,
  write: (keyed?: CommitMutation) => Promise<void>,
): Promise<void> {
  if (!mutation || !("width" in properties || "height" in properties)) return write();
  const stage = prepareCropResize(selection.element, sealedResizeStartBox(selection.element));
  const coalesceKey = `size-write:${++sizeWriteCounter}`;
  const undoStep = { coalesceKey, coalesceMs: Number.POSITIVE_INFINITY };
  const keyed: CommitMutation = (s, m, options) => mutation(s, m, { ...options, ...undoStep });
  if (mutation.batch) {
    const batch = mutation.batch;
    keyed.batch = (calls, options) => batch(calls, { ...options, ...undoStep });
  }
  await write(keyed);
  await saveCropResize(stage, selection, commit, coalesceKey, {
    width: Number.parseFloat(String(properties.width)),
    height: Number.parseFloat(String(properties.height)),
  });
}
