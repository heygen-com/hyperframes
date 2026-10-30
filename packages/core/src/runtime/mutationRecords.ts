import { HF_AUDIO_GROUP_TAG } from "../audioGroups";

// Read for timing beyond their attributes; scripts can register timelines.
const TIMING_ELEMENTS = ["video", "audio", "source", "script", HF_AUDIO_GROUP_TAG];

// Observers here pre-filter attribute records, so those always count. A child-list record counts
// only when a node it adds or removes matches or holds `selector`, or `holds` says it holds
// something the caller tracks; a text edit never does.
export function createRecordFilter(
  selector: string,
  holds: (node: Element) => boolean = () => false,
): (records: readonly MutationRecord[]) => boolean {
  const touches = (node: Node): boolean =>
    node.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).matches(selector) ||
      (node as Element).querySelector(selector) !== null ||
      holds(node as Element));
  return (records) =>
    records.some(
      (record) =>
        record.type === "attributes" ||
        Array.from(record.addedNodes).some(touches) ||
        Array.from(record.removedNodes).some(touches),
    );
}

export const createTimingRecordFilter = (timingAttributes: readonly string[]) =>
  createRecordFilter(
    [...TIMING_ELEMENTS, ...timingAttributes.map((name) => `[${name}]`)].join(","),
  );
