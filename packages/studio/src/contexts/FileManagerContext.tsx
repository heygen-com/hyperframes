import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { useFileManager } from "../hooks/useFileManager";

type FileManagerValue = ReturnType<typeof useFileManager>;

const FileManagerContext = createContext<FileManagerValue | null>(null);

export function useFileManagerContext(): FileManagerValue {
  const ctx = useContext(FileManagerContext);
  if (!ctx) throw new Error("useFileManagerContext must be used within FileManagerProvider");
  return ctx;
}

export function useFileManagerContextOptional(): FileManagerValue | null {
  return useContext(FileManagerContext);
}

export function FileManagerProvider({
  value: {
    editingFile,
    setEditingFile,
    projectDir,
    fileTree,
    fileTreeLoaded,
    setFileTree,
    editingPathRef,
    projectIdRef,
    saveRafRef,
    importedFontAssetsRef,
    readProjectFile,
    writeProjectFile,
    readOptionalProjectFile,
    observeProjectFileVersion,
    updateEditingFileContent,
    revealSourceOffset,
    openSourceForSelection,
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
    compositions,
    assets,
    fontAssets,
  },
  children,
}: {
  value: FileManagerValue;
  children: ReactNode;
}) {
  const stable = useMemo<FileManagerValue>(
    () => ({
      editingFile,
      setEditingFile,
      projectDir,
      fileTree,
      fileTreeLoaded,
      setFileTree,
      editingPathRef,
      projectIdRef,
      saveRafRef,
      importedFontAssetsRef,
      readProjectFile,
      writeProjectFile,
      readOptionalProjectFile,
      observeProjectFileVersion,
      updateEditingFileContent,
      revealSourceOffset,
      openSourceForSelection,
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
      compositions,
      assets,
      fontAssets,
    }),
    [
      editingFile,
      setEditingFile,
      projectDir,
      fileTree,
      fileTreeLoaded,
      setFileTree,
      editingPathRef,
      projectIdRef,
      saveRafRef,
      importedFontAssetsRef,
      readProjectFile,
      writeProjectFile,
      readOptionalProjectFile,
      observeProjectFileVersion,
      updateEditingFileContent,
      revealSourceOffset,
      openSourceForSelection,
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
      compositions,
      assets,
      fontAssets,
    ],
  );
  return <FileManagerContext value={stable}>{children}</FileManagerContext>;
}
