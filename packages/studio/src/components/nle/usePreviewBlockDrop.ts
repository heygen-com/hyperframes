import { useCallback, useState, type RefObject } from "react";
import { TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";

interface UsePreviewBlockDropOptions {
  portrait?: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  onBlockDrop?: (blockName: string, position: { left: number; top: number }) => void;
}

interface BlockDropPayload {
  name: string;
  dimensions?: { width: number; height: number };
}

function parseBlockPayload(raw: string): BlockDropPayload | null {
  try {
    const parsed = JSON.parse(raw) as {
      name?: string;
      dimensions?: { width: number; height: number };
    };
    return parsed.name ? (parsed as BlockDropPayload) : null;
  } catch {
    return null;
  }
}

function resolveCompositionPosition(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  portrait: boolean | undefined,
): { left: number; top: number } | null {
  if (stageRect.width === 0 || stageRect.height === 0) return null;

  const normalizedX = (clientX - stageRect.left) / stageRect.width;
  const normalizedY = (clientY - stageRect.top) / stageRect.height;

  const compWidth = portrait ? 1080 : 1920;
  const compHeight = portrait ? 1920 : 1080;

  return {
    left: Math.max(0, Math.min(normalizedX * compWidth, compWidth)),
    top: Math.max(0, Math.min(normalizedY * compHeight, compHeight)),
  };
}

function centerBlockAtPosition(
  pos: { left: number; top: number },
  block: BlockDropPayload,
): { left: number; top: number } {
  const blockW = block.dimensions?.width ?? 0;
  const blockH = block.dimensions?.height ?? 0;
  return {
    left: Math.max(0, pos.left - blockW / 2),
    top: Math.max(0, pos.top - blockH / 2),
  };
}

export function usePreviewBlockDrop({
  portrait,
  stageRef,
  onBlockDrop,
}: UsePreviewBlockDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onBlockDrop) return;
      if (!e.dataTransfer.types.includes(TIMELINE_BLOCK_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    },
    [onBlockDrop],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // fallow-ignore-next-line complexity
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      if (!onBlockDrop) return;

      const payload = e.dataTransfer.getData(TIMELINE_BLOCK_MIME);
      if (!payload) return;
      e.preventDefault();

      const block = parseBlockPayload(payload);
      const stage = stageRef.current;
      if (!block || !stage) return;

      const pos = resolveCompositionPosition(
        e.clientX,
        e.clientY,
        stage.getBoundingClientRect(),
        portrait,
      );
      if (!pos) return;

      onBlockDrop(block.name, centerBlockAtPosition(pos, block));
    },
    [onBlockDrop, stageRef, portrait],
  );

  return { isDragOver, handleDragOver, handleDragLeave, handleDrop };
}
