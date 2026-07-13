import { useCallback } from "react";
import {
  readProjectFileContent,
  saveProjectFilesWithHistory,
  type DomEditCommitBaseParams,
} from "../utils/studioFileHistory";
import { buildDomEditPatchTarget, type DomEditSelection } from "../components/editor/domEditing";

interface UseGroupCommitsParams extends DomEditCommitBaseParams {
  /** Resync the SDK session after a server-side write (the wrapper/unwrap changes
   * structure the in-memory doc doesn't know about). */
  forceReloadSdkSession?: () => void;
}

interface PatchTarget {
  id?: string | null;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
}

interface GroupGeometry {
  bbox: { left: number; top: number; width: number; height: number };
  targets: PatchTarget[];
  rebases: Array<{ target: PatchTarget; left: number; top: number }>;
}

// Wrapper sits at the members' bounding box top-left; each member is rebased so
// its absolute position is unchanged. offsetLeft/Top are layout coordinates in
// composition space (transforms excluded), exactly the space the rebase formula
// `left_new = left_old - W.left` operates in — GSAP x/y and offset vars are
// transform deltas and stay correct without adjustment.
function computeGroupGeometry(members: DomEditSelection[]): GroupGeometry {
  const boxes = members.map((m) => ({
    target: buildDomEditPatchTarget(m),
    left: m.element.offsetLeft,
    top: m.element.offsetTop,
    right: m.element.offsetLeft + m.element.offsetWidth,
    bottom: m.element.offsetTop + m.element.offsetHeight,
  }));
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const width = Math.max(...boxes.map((b) => b.right)) - left;
  const height = Math.max(...boxes.map((b) => b.bottom)) - top;
  return {
    bbox: { left, top, width, height },
    targets: boxes.map((b) => b.target),
    rebases: boxes.map((b) => ({ target: b.target, left: b.left - left, top: b.top - top })),
  };
}

// Shared read → mutate-route → save-with-history → reload pipeline for both
// wrap (group) and unwrap (ungroup). Mirrors the structural-mutation pattern in
// useElementLifecycleOps (delete). Returns the route's JSON, or throws.
async function commitStructuralMutation(
  pid: string,
  targetPath: string,
  route: "wrap-elements" | "unwrap-elements",
  body: unknown,
  label: string,
  deps: Pick<
    UseGroupCommitsParams,
    | "writeProjectFile"
    | "editHistory"
    | "domEditSaveTimestampRef"
    | "clearDomSelection"
    | "forceReloadSdkSession"
    | "reloadPreview"
  >,
): Promise<{ content?: string; groupId?: string }> {
  const originalContent = await readProjectFileContent(pid, targetPath);

  deps.domEditSaveTimestampRef.current = Date.now();
  const mutateResponse = await fetch(
    `/api/projects/${pid}/file-mutations/${route}/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!mutateResponse.ok) {
    const errBody = (await mutateResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error ?? `Failed to ${label.toLowerCase()} in ${targetPath}`);
  }
  const mutateData = (await mutateResponse.json()) as { content?: string; groupId?: string };
  const patchedContent =
    typeof mutateData.content === "string" ? mutateData.content : originalContent;

  await saveProjectFilesWithHistory({
    projectId: pid,
    label,
    kind: "manual",
    files: { [targetPath]: patchedContent },
    readFile: async () => originalContent,
    writeFile: deps.writeProjectFile,
    recordEdit: deps.editHistory.recordEdit,
  });
  deps.clearDomSelection();
  deps.forceReloadSdkSession?.();
  deps.reloadPreview();
  return mutateData;
}

export function useGroupCommits(params: UseGroupCommitsParams) {
  const { activeCompPath, showToast, projectIdRef } = params;

  const groupSelection = useCallback(
    async (members: DomEditSelection[]): Promise<string | null> => {
      const pid = projectIdRef.current;
      if (!pid || members.length === 0) return null;

      // All members must live in the same source file — the wrapper is one node
      // in one document. (Cross-file grouping is out of scope.)
      const targetPath = members[0].sourceFile || activeCompPath || "index.html";
      if (members.some((m) => (m.sourceFile || activeCompPath || "index.html") !== targetPath)) {
        showToast("Can't group elements from different files", "error");
        return null;
      }

      // Auto-name "Group N" by the count of existing groups in the document.
      const doc = members[0].element.ownerDocument;
      const groupId = `Group ${doc.querySelectorAll("[data-hf-group]").length + 1}`;
      const { bbox, targets, rebases } = computeGroupGeometry(members);

      try {
        const data = await commitStructuralMutation(
          pid,
          targetPath,
          "wrap-elements",
          { targets, groupId, bbox, rebases },
          "Group elements",
          params,
        );
        return data.groupId ?? groupId;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to group elements", "error");
        return null;
      }
    },
    [activeCompPath, projectIdRef, showToast, params],
  );

  const ungroupSelection = useCallback(
    async (group: DomEditSelection): Promise<void> => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const targetPath = group.sourceFile || activeCompPath || "index.html";

      try {
        await commitStructuralMutation(
          pid,
          targetPath,
          "unwrap-elements",
          { target: buildDomEditPatchTarget(group) },
          "Ungroup elements",
          params,
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to ungroup elements", "error");
      }
    },
    [activeCompPath, projectIdRef, showToast, params],
  );

  return { groupSelection, ungroupSelection };
}
