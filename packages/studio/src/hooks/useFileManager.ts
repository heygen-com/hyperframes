import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { EditingFile } from "../utils/studioHelpers";
import { FONT_EXT, isMediaFile } from "../utils/mediaTypes";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";
import { findTagByTarget, type PatchTarget } from "../utils/sourcePatcher";
import { trackStudioEvent } from "../utils/studioTelemetry";

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseFileManagerOptions {
  projectId: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
}

// ── Hook ──

export function useFileManager({
  projectId,
  showToast,
  recordEdit,
  domEditSaveTimestampRef,
  setRefreshKey,
}: UseFileManagerOptions) {
  // ── State ──

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compositionPaths, setCompositionPaths] = useState<string[]>([]);
  const [fileTreeLoaded, setFileTreeLoaded] = useState(false);
  const [revealSourceOffset, setRevealSourceOffset] = useState<number | null>(null);

  // ── Refs ──

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;

  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const saveRafRef = useRef<number | null>(null);
  const refreshRafRef = useRef<number | null>(null);
  const importedFontAssetsRef = useRef<ImportedFontAsset[]>([]);

  // ── Load file tree when projectId changes ──

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) {
      setFileTreeLoaded(false);
      return;
    }
    let cancelled = false;
    setFileTreeLoaded(false);
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[]; dir?: string; compositions?: string[] }) => {
        if (!cancelled && data.files) setFileTree(data.files);
        if (!cancelled && data.compositions) setCompositionPaths(data.compositions);
        if (!cancelled) setProjectDir(typeof data.dir === "string" ? data.dir : null);
      })
      .catch(() => {
        if (!cancelled) setProjectDir(null);
      })
      .finally(() => {
        if (!cancelled) setFileTreeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Core file I/O ──

  const readProjectFile = useCallback(async (path: string): Promise<string> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`Failed to read ${path}`);
    const data = (await response.json()) as { content?: string };
    if (typeof data.content !== "string") throw new Error(`Missing file contents for ${path}`);
    return data.content;
  }, []);

  const writeProjectFile = useCallback(async (path: string, content: string): Promise<void> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    if (!response.ok) throw new Error(`Failed to save ${path}`);
    if (editingPathRef.current === path) {
      setEditingFile({ path, content });
    }
  }, []);

  const updateEditingFileContent = useCallback((path: string, content: string) => {
    if (editingPathRef.current === path) {
      setEditingFile({ path, content });
    }
  }, []);

  const readOptionalProjectFile = useCallback(async (path: string): Promise<string> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(
      `/api/projects/${pid}/files/${encodeURIComponent(path)}?optional=1`,
    );
    if (!response.ok) throw new Error(`Failed to read ${path}`);
    const data = (await response.json()) as { content?: string };
    return typeof data.content === "string" ? data.content : "";
  }, []);

  // ── File select ──

  const handleFileSelect = useCallback((path: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    revealAbortRef.current?.abort();
    revealAbortRef.current = null;
    revealRequestIdRef.current++;
    // Skip fetching binary content for media files — just set the path for preview
    if (isMediaFile(path)) {
      setEditingFile({ path, content: null });
      return;
    }
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        if (data.content != null) {
          setEditingFile({ path, content: data.content });
        }
      })
      .catch(() => {});
  }, []);

  // ── Content change (debounced save) ──

  const handleContentChange = useCallback(
    (content: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const path = editingPathRef.current;
      if (!path) return;

      if (saveRafRef.current != null) cancelAnimationFrame(saveRafRef.current);
      saveRafRef.current = requestAnimationFrame(() => {
        domEditSaveTimestampRef.current = Date.now();
        saveProjectFilesWithHistory({
          projectId: pid,
          label: "Edit source",
          kind: "source",
          coalesceKey: `source:${path}`,
          files: { [path]: content },
          readFile: readProjectFile,
          writeFile: writeProjectFile,
          recordEdit,
        })
          .then(() => {
            if (refreshRafRef.current != null) cancelAnimationFrame(refreshRafRef.current);
            refreshRafRef.current = requestAnimationFrame(() => setRefreshKey((k) => k + 1));
          })
          .catch((error) => {
            trackStudioEvent("save_failure", {
              source: "code_editor",
              error_message: error instanceof Error ? error.message : "unknown",
            });
          });
      });
    },
    [domEditSaveTimestampRef, readProjectFile, recordEdit, setRefreshKey, writeProjectFile],
  );

  // ── Open source for selection (click-to-source) ──

  const revealRequestIdRef = useRef(0);
  const revealAbortRef = useRef<AbortController | null>(null);

  const openSourceForSelection = useCallback(
    (sourceFile: string, target: PatchTarget) => {
      const pid = projectIdRef.current;
      if (!pid || !sourceFile) return;
      revealAbortRef.current?.abort();
      revealAbortRef.current = null;
      if (editingPathRef.current === sourceFile && editingFile?.content != null) {
        const match = findTagByTarget(editingFile.content, target);
        setRevealSourceOffset(match ? match.start : null);
        return;
      }
      const requestId = ++revealRequestIdRef.current;
      const controller = new AbortController();
      revealAbortRef.current = controller;
      fetch(`/api/projects/${pid}/files/${encodeURIComponent(sourceFile)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data: { content?: string }) => {
          if (requestId !== revealRequestIdRef.current) return;
          if (data.content != null) {
            setEditingFile({ path: sourceFile, content: data.content });
            const match = findTagByTarget(data.content, target);
            setRevealSourceOffset(match ? match.start : null);
          }
        })
        .catch(() => {});
    },
    [editingFile?.content],
  );

  // ── File tree refresh ──

  const refreshFileTree = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const res = await fetch(`/api/projects/${pid}`);
    const data = await res.json();
    if (data.files) setFileTree(data.files);
  }, []);

  // ── Upload ──

  const uploadProjectFiles = useCallback(
    async (files: Iterable<File>, dir?: string): Promise<string[]> => {
      const pid = projectIdRef.current;
      const fileList = Array.from(files);
      if (!pid || fileList.length === 0) return [];

      const formData = new FormData();
      for (const file of fileList) {
        formData.append("file", file);
      }

      const qs = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      try {
        const res = await fetch(`/api/projects/${pid}/upload${qs}`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.skipped?.length) {
            showToast(`Skipped (too large): ${data.skipped.join(", ")}`);
          }
          if (data.invalid?.length) {
            const names = data.invalid.map((entry: { name: string }) => entry.name).join(", ");
            showToast(`Unsupported media skipped: ${names}`);
          }
          await refreshFileTree();
          setRefreshKey((k) => k + 1);
          return Array.isArray(data.files) ? data.files : [];
        } else if (res.status === 413) {
          showToast("Upload rejected: payload too large");
        } else {
          showToast(`Upload failed (${res.status})`);
        }
      } catch {
        showToast("Upload failed: network error");
      }
      return [];
    },
    [refreshFileTree, setRefreshKey, showToast],
  );

  // ── File management handlers ──

  const handleCreateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      let content = "";
      if (path.endsWith(".html")) {
        content =
          '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body>\n\n</body>\n</html>\n';
      }
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      if (res.ok) {
        await refreshFileTree();
        handleFileSelect(path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create file failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleCreateFolder = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      // Create a .gitkeep inside the folder so it appears in the tree
      const res = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(path + "/.gitkeep")}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "",
        },
      );
      if (res.ok) {
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create folder failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (editingPathRef.current === path) setEditingFile(null);
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Delete failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(oldPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (res.ok) {
        if (editingPathRef.current === oldPath) {
          handleFileSelect(newPath);
        }
        await refreshFileTree();
        // Refresh preview — references in compositions may have been updated
        setRefreshKey((k) => k + 1);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Rename failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect, setRefreshKey],
  );

  const handleDuplicateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/duplicate-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const data = await res.json();
        await refreshFileTree();
        if (data.path) handleFileSelect(data.path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Duplicate failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleMoveFile = handleRenameFile;

  const handleImportFiles = useCallback(
    async (files: FileList | File[], dir?: string) => {
      return uploadProjectFiles(Array.from(files), dir);
    },
    [uploadProjectFiles],
  );

  const handleImportFonts = useCallback(
    async (files: FileList | File[]): Promise<ImportedFontAsset[]> => {
      const uploaded = await uploadProjectFiles(
        Array.from(files).filter((file) => FONT_EXT.test(file.name)),
        "assets/fonts",
      );
      const pid = projectIdRef.current;
      const imported = uploaded
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${pid}/preview/${asset}`,
        }));
      importedFontAssetsRef.current = [
        ...imported,
        ...importedFontAssetsRef.current.filter(
          (existing) =>
            !imported.some((font) => font.family.toLowerCase() === existing.family.toLowerCase()),
        ),
      ];
      return imported;
    },
    [uploadProjectFiles],
  );

  // ── Derived state ──

  const compositions = compositionPaths;

  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );

  const fontAssets = useMemo<ImportedFontAsset[]>(
    () =>
      assets
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${projectId}/preview/${asset}`,
        })),
    [assets, projectId],
  );

  // ── Return ──

  return {
    // State
    editingFile,
    setEditingFile,
    projectDir,
    fileTree,
    fileTreeLoaded,
    setFileTree,

    // Refs
    editingPathRef,
    projectIdRef,
    saveRafRef,
    importedFontAssetsRef,

    // Core I/O
    readProjectFile,
    writeProjectFile,
    readOptionalProjectFile,
    updateEditingFileContent,

    // Click-to-source
    revealSourceOffset,
    openSourceForSelection,

    // Callbacks
    handleFileSelect,
    handleContentChange,
    refreshFileTree,
    uploadProjectFiles,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFile,
    handleRenameFile,
    handleDuplicateFile,
    handleMoveFile,
    handleImportFiles,
    handleImportFonts,

    // Derived
    compositions,
    assets,
    fontAssets,
  };
}
