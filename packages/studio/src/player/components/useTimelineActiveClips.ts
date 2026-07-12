import { useCallback, useLayoutEffect, useRef } from "react";
import { liveTime } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";

interface ActiveClipRecord {
  id: string;
  start: number;
  end: number;
  hidden: boolean;
  element: HTMLElement;
}

interface UseTimelineActiveClipsInput {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  currentTime: number;
  clipStateVersion: string;
}

function readFiniteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readClipRecord(element: Element): ActiveClipRecord | null {
  if (!(element instanceof HTMLElement)) return null;
  const id = element.dataset.elId;
  const start = readFiniteNumber(element.dataset.clipStart);
  const end = readFiniteNumber(element.dataset.clipEnd);
  const hidden = element.dataset.clipHidden === "true";
  if (!id || start === null || end === null) return null;
  return { id, start, end, hidden, element };
}

function collectTimelineClipRecords(container: HTMLElement): ActiveClipRecord[] {
  const records: ActiveClipRecord[] = [];
  for (const element of container.querySelectorAll('[data-clip="true"]')) {
    const record = readClipRecord(element);
    if (record) records.push(record);
  }
  return records;
}

function indexClipRecordsById(records: ActiveClipRecord[]): Map<string, ActiveClipRecord> {
  const recordsById = new Map<string, ActiveClipRecord>();
  for (const record of records) recordsById.set(record.id, record);
  return recordsById;
}

function getActiveClipIds(records: ActiveClipRecord[], time: number): Set<string> {
  const next = new Set<string>();
  if (!Number.isFinite(time)) return next;
  for (const record of records) {
    if (record.hidden) continue;
    if (time >= record.start && time <= record.end) next.add(record.id);
  }
  return next;
}

function setsMatch(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function applyActiveClipDiff(
  records: ActiveClipRecord[],
  previous: Set<string>,
  time: number,
  // Force every record's attribute to match its active state instead of only
  // touching clips whose active-state changed. Required whenever `records` were
  // freshly re-queried after a render: a clip that stayed active but got a new
  // DOM node (e.g. moved lanes on a reorder) would otherwise be skipped by the
  // diff and render without `data-active` despite still being at the playhead.
  syncAll = false,
) {
  const next = getActiveClipIds(records, time);
  const changed = !setsMatch(previous, next);
  for (const record of records) {
    const wasActive = previous.has(record.id);
    const isActive = next.has(record.id);
    if (!syncAll && wasActive === isActive) continue;
    record.element.toggleAttribute("data-active", isActive);
  }
  previous.clear();
  for (const id of next) previous.add(id);
  return changed;
}

export function updateTimelineActiveClipClasses(
  container: HTMLElement,
  previous: Set<string>,
  time: number,
  syncAll = false,
) {
  applyActiveClipDiff(collectTimelineClipRecords(container), previous, time, syncAll);
}

export function useTimelineActiveClips({
  scrollRef,
  currentTime,
  clipStateVersion,
}: UseTimelineActiveClipsInput) {
  const recordsRef = useRef<ActiveClipRecord[]>([]);
  const recordsByIdRef = useRef(new Map<string, ActiveClipRecord>());
  const previousActiveIdsRef = useRef(new Set<string>());

  const refreshRecords = useCallback(
    (time: number) => {
      const scroll = scrollRef.current;
      if (!scroll) {
        recordsRef.current = [];
        recordsByIdRef.current.clear();
        previousActiveIdsRef.current.clear();
        return;
      }
      recordsRef.current = collectTimelineClipRecords(scroll);
      recordsByIdRef.current = indexClipRecordsById(recordsRef.current);
      applyActiveClipDiff(recordsRef.current, previousActiveIdsRef.current, time, true);
    },
    [scrollRef],
  );

  useLayoutEffect(() => {
    refreshRecords(currentTime);
  }, [currentTime, clipStateVersion, refreshRecords]);

  useMountEffect(() => {
    const unsub = liveTime.subscribe((time) => {
      applyActiveClipDiff(recordsRef.current, previousActiveIdsRef.current, time);
    });
    return unsub;
  });
}
