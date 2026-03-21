import { useRef, useState, useCallback } from "react";

export interface UndoEntry {
  elementId: string;
  oldStart: number;
  newStart: number;
}

const MAX_STACK = 50;

export function useUndoRedo() {
  const undoRef = useRef<UndoEntry[]>([]);
  const redoRef = useRef<UndoEntry[]>([]);
  const [version, setVersion] = useState(0);

  const bump = () => setVersion((v) => v + 1);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoRef.current.push(entry);
    if (undoRef.current.length > MAX_STACK) {
      undoRef.current.shift();
    }
    redoRef.current = [];
    bump();
  }, []);

  const popUndo = useCallback((): UndoEntry | null => {
    const entry = undoRef.current.pop();
    if (!entry) return null;
    redoRef.current.push(entry);
    bump();
    return entry;
  }, []);

  const popRedo = useCallback((): UndoEntry | null => {
    const entry = redoRef.current.pop();
    if (!entry) return null;
    undoRef.current.push(entry);
    bump();
    return entry;
  }, []);

  // version is read so React tracks re-renders
  void version;
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  return { pushUndo, popUndo, popRedo, canUndo, canRedo };
}
