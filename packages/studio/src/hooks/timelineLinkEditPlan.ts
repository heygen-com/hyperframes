import type { TimelineElement } from "../player";
import type { TimelineLinkEdit } from "../player/components/timelineCallbacks";
import { buildPatchTarget, type PatchTarget } from "./timelineEditingHelpers";
import {
  detachAudioInSource,
  linkInSource,
  mergeAudioInSource,
  pickDetachedAudioTrack,
  setLinkInSource,
} from "../components/editor/mediaLinkEdits";

export interface LinkEditPlan {
  label: string;
  anchor: TimelineElement;
  transform: (source: string) => string | null;
}

const keyOf = (el: TimelineElement) => el.key ?? el.id;

function targetsOf(elements: readonly TimelineElement[]): PatchTarget[] | null {
  const targets = elements.map(buildPatchTarget);
  return targets.every((target): target is PatchTarget => target !== null) ? targets : null;
}

/**
 * The clips to strip `data-link` from when `removed` leave their groups: the
 * removed clips themselves, plus any partner left alone in its group.
 */
export function clipsToUnlink(
  removed: readonly TimelineElement[],
  elements: readonly TimelineElement[],
): TimelineElement[] {
  const removedKeys = new Set(removed.map(keyOf));
  const links = new Set(removed.map((el) => el.link).filter(Boolean));
  const orphans: TimelineElement[] = [];
  for (const link of links) {
    const survivors = elements.filter((el) => el.link === link && !removedKeys.has(keyOf(el)));
    if (survivors.length === 1 && survivors[0]) orphans.push(survivors[0]);
  }
  return [...removed.filter((el) => el.link), ...orphans];
}

export function planLinkEdit(
  edit: TimelineLinkEdit,
  elements: readonly TimelineElement[],
): LinkEditPlan | null {
  switch (edit.kind) {
    case "unlink": {
      const members = clipsToUnlink(edit.elements, elements);
      const targets = targetsOf(members);
      const anchor = members[0];
      if (!targets || !anchor) return null;
      return { label: "Unlink clips", anchor, transform: (s) => setLinkInSource(s, targets, null) };
    }
    case "link": {
      const targets = targetsOf(edit.elements);
      const anchor = edit.elements[0];
      if (!targets || !anchor) return null;
      return { label: "Link clips", anchor, transform: (s) => linkInSource(s, targets) };
    }
    case "detach": {
      const target = buildPatchTarget(edit.element);
      if (!target) return null;
      const track = pickDetachedAudioTrack(elements, edit.element);
      return {
        label: "Detach audio",
        anchor: edit.element,
        transform: (s) =>
          detachAudioInSource(s, { target, videoId: edit.element.domId ?? null, track })?.html ??
          null,
      };
    }
    case "merge": {
      const videoTarget = buildPatchTarget(edit.video);
      const audioTarget = buildPatchTarget(edit.audio);
      if (!videoTarget || !audioTarget) return null;
      return {
        label: "Merge audio back into video",
        anchor: edit.video,
        transform: (s) => mergeAudioInSource(s, { videoTarget, audioTarget }),
      };
    }
  }
}
