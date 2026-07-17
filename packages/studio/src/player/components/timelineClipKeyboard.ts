import type { KeyboardEvent, RefObject } from "react";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineRowGeometry } from "./timelineLayout";
import {
  isTimelineNavigationKey,
  resolveTimelineKeyboardTarget,
} from "./timelineKeyboardNavigation";

interface TimelineClipKeyboardInput {
  event: KeyboardEvent<Element>;
  element: TimelineElement;
  tracks: readonly [number, TimelineElement[]][];
  displayTrackOrder: readonly number[];
  rowGeometry: TimelineRowGeometry;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentOrigin: number;
  pixelsPerSecond: number;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onSelectElement?: (element: TimelineElement | null) => void;
  setSelectedElementId: (identity: string | null) => void;
}

function identityOf(element: TimelineElement): string {
  return element.key ?? element.id;
}

function focusClipAfterMount(identity: string): void {
  requestAnimationFrame(() => {
    const candidate = Array.from(
      document.querySelectorAll<HTMLElement>("[data-clip][data-el-id]"),
    ).find((node) => node.dataset.elId === identity);
    candidate?.focus();
  });
}

function select(input: TimelineClipKeyboardInput, element: TimelineElement | null): void {
  input.setSelectedElementId(element ? identityOf(element) : null);
  input.onSelectElement?.(element);
}

/** Keyboard actor for a logical clip. Navigation never depends on mounted siblings. */
export function handleTimelineClipKeyDown(input: TimelineClipKeyboardInput): void {
  const { event, element, tracks, displayTrackOrder } = input;
  const identity = identityOf(element);

  if (event.key === "Delete" || event.key === "Backspace") {
    if (!input.onDeleteElement) return;
    event.preventDefault();
    const previous = resolveTimelineKeyboardTarget(
      tracks,
      displayTrackOrder,
      identity,
      "ArrowLeft",
    );
    const next = resolveTimelineKeyboardTarget(tracks, displayTrackOrder, identity, "ArrowRight");
    const fallback =
      previous && identityOf(previous) !== identity
        ? previous
        : next && identityOf(next) !== identity
          ? next
          : null;
    void input.onDeleteElement(element);
    select(input, fallback);
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    select(input, element);
    return;
  }
  if (!isTimelineNavigationKey(event.key)) return;

  event.preventDefault();
  const target = resolveTimelineKeyboardTarget(tracks, displayTrackOrder, identity, event.key);
  if (!target) return;
  const targetIdentity = identityOf(target);
  select(input, target);

  const targetRow = input.rowGeometry.getRowIndex(target.track);
  const scroll = input.scrollRef.current;
  if (scroll && targetRow >= 0) {
    scroll.scrollTop = Math.max(0, input.rowGeometry.getRowTop(targetRow));
    const targetLeft = input.contentOrigin + target.start * input.pixelsPerSecond;
    if (targetLeft < scroll.scrollLeft + input.contentOrigin) {
      scroll.scrollLeft = Math.max(0, targetLeft - input.contentOrigin);
    } else if (targetLeft > scroll.scrollLeft + scroll.clientWidth) {
      scroll.scrollLeft = Math.max(0, targetLeft - scroll.clientWidth / 2);
    }
  }
  focusClipAfterMount(targetIdentity);
}
