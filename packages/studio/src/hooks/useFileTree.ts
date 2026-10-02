import { buildProjectApiPath } from "../utils/projectRouting";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { FONT_EXT } from "../utils/mediaTypes";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import { captureProjectProvenance } from "../components/feedback/projectProvenance";

interface UseFileTreeOptions {
  projectId: string | null;
  projectIdRef: React.RefObject<string | null>;
}

interface FetchedFileTree {
  projectId: string;
  loaded: boolean;
  fileTree: string[];
  compositionPaths: string[];
  projectDir: string | null;
}

// Stable references so a mismatched projectId doesn't create a new array every render
// and defeat useMemo/useCallback deps downstream (e.g. the `assets` memo below).
const EMPTY_FILE_LIST: string[] = [];

/**
 * Holds the tree with the `projectId` it was fetched for; exposes empty/not-loaded
 * whenever that id doesn't match the current one, so a switch can't read another project's tree.
 */
export function useFileTree({ projectId, projectIdRef }: UseFileTreeOptions) {
  const [fetched, setFetched] = useState<FetchedFileTree | null>(null);
  const current = fetched?.projectId === projectId ? fetched : null;
  const fileTree = current?.fileTree ?? EMPTY_FILE_LIST;
  const compositionPaths = current?.compositionPaths ?? EMPTY_FILE_LIST;
  const projectDir = current?.projectDir ?? null;
  const fileTreeLoaded = current?.loaded ?? false;

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setFetched({ projectId, loaded: false, fileTree: [], compositionPaths: [], projectDir: null });
    fetch(buildProjectApiPath(projectId))
      // An unresolvable project answers 404 with a JSON body, so without this
      // the error path parsed cleanly and the success branch below recorded an
      // empty tree — and an empty provenance snapshot — for a project that was
      // never read. Throwing hands it to the catch instead.
      .then((r) => {
        if (!r.ok) throw new Error(`tree fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data: { files?: string[]; dir?: string; compositions?: string[] }) => {
        if (cancelled) return;
        setFetched({
          projectId,
          loaded: true,
          fileTree: data.files ?? [],
          compositionPaths: data.compositions ?? [],
          projectDir: typeof data.dir === "string" ? data.dir : null,
        });
        // Snapshot how this project was made, while the listing is in hand and
        // the app is still alive. A crash later has no other way to learn it.
        void captureProjectProvenance(projectId, data.files ?? [], data.compositions ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setFetched((prev) => (prev?.projectId === projectId ? { ...prev, loaded: true } : prev));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refreshRequestRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);

  const refreshFileTree = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    // Same id+abort pair as useFileManager.ts's openSourceForSelection: cancel the
    // superseded request instead of letting it complete and discarding the result.
    refreshAbortRef.current?.abort();
    const requestId = ++refreshRequestRef.current;
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    let data: { files?: string[]; compositions?: string[] };
    try {
      const res = await fetch(buildProjectApiPath(pid), { signal: controller.signal });
      data = await res.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
    if (data.files && requestId === refreshRequestRef.current) {
      setFetched((prev) =>
        prev?.projectId === pid
          ? {
              ...prev,
              fileTree: data.files ?? prev.fileTree,
              // A response that omits `compositions` must not wipe out a
              // known-good list — only replace it when the field is present.
              compositionPaths: data.compositions ?? prev.compositionPaths,
            }
          : prev,
      );
    }
  }, [projectIdRef]);

  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );

  const fontAssets = useMemo<ImportedFontAsset[]>(
    () =>
      (projectId ? assets : [])
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: projectId ? buildProjectApiPath(projectId, `/preview/${asset}`) : "",
        })),
    [assets, projectId],
  );

  return {
    projectDir,
    fileTree,
    fileTreeLoaded,
    refreshFileTree,
    compositions: compositionPaths,
    assets,
    fontAssets,
  };
}
