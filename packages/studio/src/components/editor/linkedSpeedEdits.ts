import { usePlayerStore, type TimelineElement } from "../../player/store/playerStore";
import { expandToLinkedMembers } from "../../player/components/audioClipLink";
import {
  applyPatchByTarget,
  readAttributeByTarget,
  type PatchTarget,
} from "../../utils/sourcePatcher";
import type { CommitDomAttributeBatch } from "../../hooks/domEditCommitTypes";
import type { DomEditSelection } from "./domEditingTypes";

type AttributeValueFor = (current: string | undefined) => string | null;

/** Writes a speed attribute on the selection and every `data-link` partner as one undo step. */
export interface LinkedSpeedCommit {
  commitAttribute: (attr: string, valueFor: AttributeValueFor, label: string) => Promise<boolean>;
}

const keyOf = (el: TimelineElement) => el.key ?? el.id;
const dataProperty = (attr: string) => (attr.startsWith("data-") ? attr.slice(5) : attr);

function targetOf(el: TimelineElement): PatchTarget {
  const target: PatchTarget = { id: el.domId ?? el.id };
  if (el.hfId) target.hfId = el.hfId;
  return target;
}

function isSelected(el: TimelineElement, selection: PatchTarget): boolean {
  if (selection.hfId && el.hfId) return el.hfId === selection.hfId;
  return selection.id != null && (el.domId ?? el.id) === selection.id;
}

export function linkedPartnerTargets(
  selection: PatchTarget,
  elements: readonly TimelineElement[],
): PatchTarget[] {
  const self = elements.find((el) => isSelected(el, selection));
  if (!self?.link) return [];
  const members = expandToLinkedMembers([keyOf(self)], elements);
  members.delete(keyOf(self));
  return elements.filter((el) => members.has(keyOf(el))).map(targetOf);
}

export function fanOutAttributeInSource(
  source: string,
  targets: readonly PatchTarget[],
  attr: string,
  valueFor: AttributeValueFor,
): string {
  const property = dataProperty(attr);
  return targets.reduce(
    (html, target) =>
      applyPatchByTarget(html, target, {
        type: "attribute",
        property,
        value: valueFor(readAttributeByTarget(html, target, attr)),
      }),
    source,
  );
}

/** Null when the selection has no link partner, so unlinked clips keep their usual write path. */
export function useLinkedSpeedCommit(
  selection: DomEditSelection,
  commit: CommitDomAttributeBatch | undefined,
): LinkedSpeedCommit | null {
  const elements = usePlayerStore((s) => s.elements);
  if (!commit) return null;
  const partners = linkedPartnerTargets(selection, elements);
  if (partners.length === 0) return null;
  return {
    commitAttribute: (attr, valueFor, label) => {
      const property = dataProperty(attr);
      return commit(
        selection,
        [{ type: "attribute", property, value: valueFor(selection.dataAttributes[property]) }],
        {
          label,
          prepareContent: (html) => fanOutAttributeInSource(html, partners, attr, valueFor),
        },
      );
    },
  };
}

/** Routes `playback-rate` through the linked commit; every other attribute keeps `onSetAttribute`. */
export function withLinkedPlaybackRate(
  onSetAttribute: (attr: string, value: string) => void | Promise<void>,
  linked: LinkedSpeedCommit | null,
): (attr: string, value: string) => void | Promise<void> {
  if (!linked) return onSetAttribute;
  return async (attr, value) => {
    if (attr !== "playback-rate") return onSetAttribute(attr, value);
    await linked.commitAttribute("data-playback-rate", () => value, "Edit speed");
  };
}
