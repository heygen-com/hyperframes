/**
 * In-window drag payload registry. HTML5 DnD hides dataTransfer payloads until
 * drop (Chrome protected mode), but drags that originate inside the studio can
 * publish their payload here so drag-over UI (ghost, snap) knows what is being
 * dragged. OS-file drags never appear here — callers must fall back to
 * dataTransfer.items MIME hints.
 */
export interface DragSessionPayload {
  source: "asset" | "block";
  path?: string;
  blockName?: string;
  kind: "image" | "video" | "audio" | "block";
  durationSec: number | null;
  label: string;
}

let active: DragSessionPayload | null = null;

export function beginDragSession(payload: DragSessionPayload): void {
  active = payload;
}

export function endDragSession(): void {
  active = null;
}

export function getActiveDragSession(): DragSessionPayload | null {
  return active;
}
