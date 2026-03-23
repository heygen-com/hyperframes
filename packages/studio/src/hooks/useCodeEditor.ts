import { useState, useCallback } from "react";

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
}

export interface UseCodeEditorReturn {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  activeFile: OpenFile | null;
  openFile: (path: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateContent: (content: string) => void;
  markSaved: (path: string) => void;
  /** External update from agent — updates saved content, shows reload indicator */
  externalUpdate: (path: string, content: string) => void;
}

export function useCodeEditor(): UseCodeEditorReturn {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;

  const openFile = useCallback((path: string, content: string) => {
    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.path === path);
      if (existing) return prev;
      return [...prev, { path, content, savedContent: content, isDirty: false }];
    });
    setActiveFilePath(path);
  }, []);

  const closeFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => prev.filter((f) => f.path !== path));
      setActiveFilePath((prev) => {
        if (prev === path) {
          const remaining = openFiles.filter((f) => f.path !== path);
          return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
        }
        return prev;
      });
    },
    [openFiles],
  );

  const updateContent = useCallback(
    (content: string) => {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === activeFilePath ? { ...f, content, isDirty: content !== f.savedContent } : f,
        ),
      );
    },
    [activeFilePath],
  );

  const markSaved = useCallback((path: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, savedContent: f.content, isDirty: false } : f)),
    );
  }, []);

  const externalUpdate = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === path ? { ...f, savedContent: content, content, isDirty: false } : f,
      ),
    );
  }, []);

  return {
    openFiles,
    activeFilePath,
    activeFile,
    openFile,
    closeFile,
    setActiveFile: setActiveFilePath,
    updateContent,
    markSaved,
    externalUpdate,
  };
}
