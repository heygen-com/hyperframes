import { useCallback, useRef } from "react";
import { findUnsafeMutationValues } from "@hyperframes/core/studio-api/finite-mutation";
import type { AnimeJsPropertyValue, ParsedAnimeJs } from "@hyperframes/core/animejs-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { applySoftReload } from "../utils/gsapSoftReload";
import { usePlayerStore } from "../player/store/playerStore";
import { createKeyedSerializer } from "./serializeByKey";
import {
  GsapMutationHttpError,
  formatGsapMutationRejectionToast,
  readJsonResponseBody,
} from "./gsapScriptCommitHelpers";
import { animeFileSerializeKey } from "../utils/sdkCutover";
import type { CommitMutationOptions, GsapScriptCommitsParams } from "./gsapScriptCommitTypes";
import { valueForAnimePropertyUpdate } from "./animeAnimationAdapter";
import { fetchParsedAnimeAnimations } from "./useAnimeTweenCache";

interface AnimeMutationResult {
  ok: boolean;
  changed?: boolean;
  parsed?: ParsedAnimeJs;
  before?: string;
  after?: string;
  scriptText?: string;
}

async function mutateAnimeScript(
  projectId: string,
  sourceFile: string,
  mutation: Record<string, unknown>,
): Promise<AnimeMutationResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/animejs-mutations/${encodeURIComponent(sourceFile)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
    },
  );
  if (!res.ok) throw new GsapMutationHttpError(res.status, await readJsonResponseBody(res));
  const result = (await res.json()) as AnimeMutationResult;
  if (!result.ok) throw new Error(`Failed to update anime.js in ${sourceFile}`);
  return result;
}

function msFromSeconds(value: number | string | undefined): number | string | undefined {
  return typeof value === "number" ? Math.round(value * 1000) : value;
}

function animeMetaUpdates(updates: {
  duration?: number;
  ease?: string;
  easeEach?: string;
  position?: number;
}): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  if (updates.duration !== undefined) result.duration = msFromSeconds(updates.duration) ?? 0;
  const ease = updates.ease ?? updates.easeEach;
  if (ease !== undefined) result.ease = ease;
  if (updates.position !== undefined) result.position = msFromSeconds(updates.position) ?? 0;
  return result;
}

export function useAnimeScriptCommits({
  projectIdRef,
  activeCompPath,
  previewIframeRef,
  editHistory,
  domEditSaveTimestampRef,
  reloadPreview,
  onCacheInvalidate,
  onFileContentChanged,
  showToast,
  // fallow-ignore-next-line code-duplication
  forceReloadSdkSession,
}: GsapScriptCommitsParams) {
  const serializerRef = useRef(createKeyedSerializer());

  const runCommit = useCallback(
    // fallow-ignore-next-line complexity
    async (
      selection: DomEditSelection,
      mutation: Record<string, unknown>,
      options: CommitMutationOptions,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const unsafeFields = findUnsafeMutationValues(mutation);
      if (unsafeFields.length > 0) {
        showToast?.(
          "Couldn't read element layout - try again at a different playhead time",
          "error",
        );
        if (options.skipReload) return;
        throw new Error(
          `Mutation contains unsafe values: ${unsafeFields.map((field) => field.path).join(", ")}`,
        );
      }
      // fallow-ignore-next-line code-duplication
      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      let result: AnimeMutationResult;
      try {
        result = await mutateAnimeScript(pid, targetPath, mutation);
      } catch (error) {
        if (error instanceof GsapMutationHttpError) {
          showToast?.(formatGsapMutationRejectionToast(error), "error");
        }
        // fallow-ignore-next-line code-duplication
        if (options.skipReload) return;
        throw error;
      }
      // fallow-ignore-next-line code-duplication
      if (result.changed === false) return;
      domEditSaveTimestampRef.current = Date.now();
      if (result.before != null && result.after != null) {
        await editHistory.recordEdit({
          label: options.label,
          kind: "manual",
          coalesceKey: options.coalesceKey,
          files: { [targetPath]: { before: result.before, after: result.after } },
        });
      }
      if (result.after != null) onFileContentChanged?.(targetPath, result.after);
      forceReloadSdkSession?.();
      if (options.skipReload) return;
      options.beforeReload?.();
      if (options.softReload && result.scriptText) {
        const currentTime = usePlayerStore.getState().currentTime;
        const softResult = applySoftReload(
          previewIframeRef.current,
          result.scriptText,
          reloadPreview,
          currentTime,
        );
        if (softResult === "cannot-soft-reload") reloadPreview();
      } else {
        reloadPreview();
      }
      onCacheInvalidate();
    },
    [
      activeCompPath,
      domEditSaveTimestampRef,
      editHistory,
      forceReloadSdkSession,
      onCacheInvalidate,
      onFileContentChanged,
      previewIframeRef,
      projectIdRef,
      reloadPreview,
      showToast,
    ],
  );

  const commitMutation = useCallback(
    (
      selection: DomEditSelection,
      mutation: Record<string, unknown>,
      options: CommitMutationOptions,
    ) => {
      const file = selection.sourceFile || activeCompPath || "index.html";
      const key = options.serializeKey ?? animeFileSerializeKey(file);
      return serializerRef.current(key, () => runCommit(selection, mutation, options));
    },
    [activeCompPath, runCommit],
  );

  const updateAnimeProperty = useCallback(
    async (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      value: number | string,
    ) => {
      const pid = projectIdRef.current;
      const sourceFile = selection.sourceFile || activeCompPath || "index.html";
      const parsed = pid ? await fetchParsedAnimeAnimations(pid, sourceFile) : null;
      const existing = parsed?.animations.find((animation) => animation.id === animationId)
        ?.properties[property];
      const nextValue = valueForAnimePropertyUpdate(existing, value);
      await commitMutation(
        selection,
        { type: "update-property", animationId, property, value: nextValue },
        {
          label: "Update anime.js property",
          softReload: true,
          coalesceKey: `animejs:${animationId}:${property}`,
        },
      );
    },
    [activeCompPath, commitMutation, projectIdRef],
  );

  const updateAnimeMeta = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      updates: { duration?: number; ease?: string; easeEach?: string; position?: number },
    ) =>
      commitMutation(
        selection,
        { type: "update-meta", animationId, updates: animeMetaUpdates(updates) },
        { label: "Update anime.js animation", softReload: true },
      ),
    [commitMutation],
  );

  const deleteAnimeAnimation = useCallback(
    (selection: DomEditSelection, animationId: string) =>
      commitMutation(
        selection,
        { type: "delete", animationId },
        { label: "Remove anime.js animation", softReload: true },
      ),
    [commitMutation],
  );

  const addAnimeAnimation = useCallback(
    (selection: DomEditSelection, method: "to" | "from" | "set" | "fromTo", time: number) => {
      const targetSelector = selection.id ? `#${selection.id}` : selection.selector;
      if (!targetSelector) return Promise.resolve();
      const isSet = method === "set";
      return commitMutation(
        selection,
        {
          type: "add",
          method: isSet ? "set" : "add",
          targetSelector,
          position: msFromSeconds(time),
          duration: isSet ? 0 : 500,
          ease: "outQuad",
          properties: isSet ? { opacity: 1 } : { opacity: [0, 1] },
        },
        { label: "Add anime.js animation", softReload: true },
      );
    },
    [commitMutation],
  );

  const addAnimeProperty = useCallback(
    (selection: DomEditSelection, animationId: string, property: string) =>
      updateAnimeProperty(selection, animationId, property, 0),
    [updateAnimeProperty],
  );

  const noop = useCallback(() => {}, []);

  const updateAnimePropertyKeyframe = useCallback(
    (
      selection: DomEditSelection,
      animationId: string,
      property: string,
      index: number,
      updates: Record<string, AnimeJsPropertyValue>,
    ) =>
      commitMutation(
        selection,
        { type: "update-property-keyframe", animationId, property, index, updates },
        { label: "Update anime.js keyframe", softReload: true },
      ),
    [commitMutation],
  );

  return {
    commitMutation,
    updateAnimeProperty,
    updateAnimeMeta,
    deleteAnimeAnimation,
    addAnimeAnimation,
    addAnimeProperty,
    removeAnimeProperty: noop,
    updateAnimePropertyKeyframe,
  };
}
