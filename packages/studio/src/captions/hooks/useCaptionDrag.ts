import { useRef, useCallback } from "react";
import { useCaptionStore } from "../store";

interface DragState {
  segmentId: string;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
}

export function useCaptionDrag(scale: number) {
  const dragRef = useRef<DragState | null>(null);

  const model = useCaptionStore((s) => s.model);
  const selectedGroupId = useCaptionStore((s) => s.selectedGroupId);
  const updateSegmentStyle = useCaptionStore((s) => s.updateSegmentStyle);
  const updateGroupStyle = useCaptionStore((s) => s.updateGroupStyle);

  const onPointerDown = useCallback(
    (segmentId: string, e: React.PointerEvent) => {
      if (!model) return;

      const segment = model.segments.get(segmentId);
      if (!segment) return;

      // Resolve x/y: group style as base, segment style as override
      const groupId = model.groupOrder.find((gid) => {
        const g = model.groups.get(gid);
        return g?.segmentIds.includes(segmentId) ?? false;
      });
      const group = groupId ? model.groups.get(groupId) : undefined;

      const resolvedX = segment.style.x ?? group?.style.x ?? 0;
      const resolvedY = segment.style.y ?? group?.style.y ?? 0;

      (e.currentTarget as Element).setPointerCapture(e.pointerId);

      dragRef.current = {
        segmentId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: resolvedX,
        startY: resolvedY,
      };
    },
    [model],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !model) return;

      const deltaX = (e.clientX - drag.startMouseX) / scale;
      const deltaY = (e.clientY - drag.startMouseY) / scale;

      const newX = drag.startX + deltaX;
      const newY = drag.startY + deltaY;

      if (selectedGroupId) {
        updateGroupStyle(selectedGroupId, { x: newX, y: newY });
      } else {
        updateSegmentStyle(drag.segmentId, { x: newX, y: newY });
      }
    },
    [model, scale, selectedGroupId, updateGroupStyle, updateSegmentStyle],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp };
}
