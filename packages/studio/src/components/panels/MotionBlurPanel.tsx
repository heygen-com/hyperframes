import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Composition } from "@hyperframes/sdk";
import {
  MOTION_BLUR_LIMITS,
  type ElementMotionBlurSettings,
  type MotionBlurSettings,
} from "@hyperframes/core/motion-blur-settings";
import { useStudioPlaybackContext, useStudioShellContext } from "../../contexts/StudioContext";
import { useFileManagerContext } from "../../contexts/FileManagerContext";
import { usePlayerStore } from "../../player/store/playerStore";
import {
  useVariablesPersist,
  type UseVariablesPersistParams,
} from "../../hooks/useVariablesPersist";
import { resolveMasterCompositionPath } from "../../utils/studioUrlState";
import { Button } from "../ui";
import {
  BLUR_LEVELS,
  ELEMENT_BLUR_MODES,
  changedEdits,
  changedElementEdits,
  elementSettingsOf,
  findCompositionRoot,
  levelOf,
  patchForLevel,
  readPreviewElementAttributes,
  readPreviewRootAttributes,
  sameAttributes,
  settingsOf,
  withEdits,
  type BlurLevel,
  type RootAttributes,
} from "./motionBlurPanelModel";

export interface MotionBlurPanelProps {
  sdkSession: Composition | null;
  publishSdkSession?: UseVariablesPersistParams["publishSdkSession"];
  reloadPreview: () => void;
  recordEdit: UseVariablesPersistParams["recordEdit"];
}

const POLL_MS = 500;
/** After a write the preview is reloading: keep what was just written instead of the old document. */
const SETTLE_MS = 1500;

/** Thrown from the edit when the file already holds the level, so nothing is written or recorded for undo. */
class NothingToChange extends Error {}

/** The preview's own attributes, polled; `hold` pins an optimistic value until the preview catches up. */
function useLivePreviewAttributes(
  readAttributes: () => RootAttributes | null,
  refreshKey: number,
  resetKey?: string | null,
) {
  const [live, setLive] = useState<RootAttributes | null>(null);
  const holdUntil = useRef(0);
  useEffect(() => {
    holdUntil.current = 0;
    const read = () => {
      const found = readAttributes();
      if (Date.now() >= holdUntil.current) {
        setLive((current) => (sameAttributes(current, found) ? current : found));
      }
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [readAttributes, refreshKey, resetKey]);
  const hold = useCallback((next: (current: RootAttributes | null) => RootAttributes) => {
    holdUntil.current = Date.now() + SETTLE_MS;
    setLive(next);
  }, []);
  return [live, hold] as const;
}

export const MotionBlurPanel = memo(function MotionBlurPanel({
  sdkSession,
  publishSdkSession,
  reloadPreview,
  recordEdit,
}: MotionBlurPanelProps) {
  const { activeCompPath, previewIframeRef, showToast } = useStudioShellContext();
  const { refreshKey } = useStudioPlaybackContext();
  const { readProjectFile, writeProjectFile, compositions } = useFileManagerContext();
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const readRoot = useCallback(
    () => readPreviewRootAttributes(previewIframeRef.current),
    [previewIframeRef],
  );
  const [live, hold] = useLivePreviewAttributes(readRoot, refreshKey);

  useEffect(() => sdkSession?.on("change", rerender), [sdkSession]);

  const root = sdkSession ? findCompositionRoot(sdkSession.getRootElements()) : null;
  const selectedElement =
    sdkSession && selectedElementId ? sdkSession.getElement(selectedElementId) : null;
  const elementTarget =
    selectedElement && selectedElement.id !== root?.id ? selectedElement : null;
  const readElement = useCallback(
    () => readPreviewElementAttributes(previewIframeRef.current, elementTarget?.id ?? null),
    [previewIframeRef, elementTarget?.id],
  );
  const [liveElement, holdElement] = useLivePreviewAttributes(
    readElement,
    refreshKey,
    elementTarget?.id ?? null,
  );
  const elementAttributes = liveElement ?? elementTarget?.attributes ?? null;
  const elementSettings = useMemo(
    () => (elementAttributes ? elementSettingsOf(elementAttributes) : null),
    [elementAttributes],
  );
  // The preview's own root is the truth after an undo or an outside edit, which the shared session does not follow.
  const attributes = live ?? root?.attributes ?? null;
  const settings = useMemo(() => (attributes ? settingsOf(attributes) : null), [attributes]);
  const isMain =
    activeCompPath == null || activeCompPath === resolveMasterCompositionPath(compositions);
  const persist = useVariablesPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    publishSdkSession,
  });

  const apply = useCallback(
    async (patch: Partial<MotionBlurSettings>) => {
      if (!attributes) return;
      // The write lands on the file's own root, so the edits are worked out there, not from the preview.
      let applied: Array<{ name: string; value: string | null }> = [];
      try {
        await persist("Edit motion blur", (session) => {
          const target = findCompositionRoot(session.getRootElements());
          if (!target) return;
          const next = { ...settingsOf(target.attributes), ...patch };
          applied = changedEdits(target.attributes, next);
          if (applied.length === 0) throw new NothingToChange();
          for (const e of applied) {
            session.dispatch({
              type: "setAttribute",
              target: target.id,
              name: e.name,
              value: e.value,
            });
          }
        });
        hold((current) => withEdits(current ?? attributes, applied));
        rerender();
      } catch (err) {
        if (err instanceof NothingToChange) return;
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [attributes, persist, hold, showToast],
  );

  const applyElement = useCallback(
    async (patch: Partial<ElementMotionBlurSettings>) => {
      if (!elementTarget || !elementAttributes) return;
      let applied: Array<{ name: string; value: string | null }> = [];
      try {
        await persist("Edit element motion blur", (session) => {
          const target = session.getElement(elementTarget.id);
          if (!target) return;
          const next = { ...elementSettingsOf(target.attributes), ...patch };
          applied = changedElementEdits(target.attributes, next);
          if (applied.length === 0) throw new NothingToChange();
          for (const e of applied) {
            session.dispatch({
              type: "setAttribute",
              target: target.id,
              name: e.name,
              value: e.value,
            });
          }
        });
        holdElement((current) => withEdits(current ?? elementAttributes, applied));
        rerender();
      } catch (err) {
        if (err instanceof NothingToChange) return;
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [elementTarget, elementAttributes, persist, holdElement, showToast],
  );

  const commitShutterDraft = useCallback(
    (raw: string, reset: (next: string) => void) => {
      if (!elementSettings) return;
      const trimmed = raw.trim();
      if (trimmed === "") {
        void applyElement({ shutterDeg: null });
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        reset(elementSettings.shutterDeg === null ? "" : String(elementSettings.shutterDeg));
        return;
      }
      const { min, max } = MOTION_BLUR_LIMITS.shutterDeg;
      const clamped = Math.min(max, Math.max(min, parsed));
      reset(String(clamped));
      void applyElement({ shutterDeg: clamped });
    },
    [applyElement, elementSettings],
  );

  if (!settings) {
    return (
      <p className="p-3 text-[10px] leading-relaxed text-neutral-500">
        Open a composition to set up motion blur.
      </p>
    );
  }
  const locked = !isMain;
  // A sub-composition's own root is not the setting being edited, so no level is shown while locked.
  const current = locked ? null : levelOf(settings);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-[11px] text-neutral-300">
      <span className="text-[12px] font-medium text-neutral-100">Motion blur (Beta)</span>
      <div role="radiogroup" aria-label="Motion blur" className="flex gap-1.5">
        {BLUR_LEVELS.map(({ level, label }) => (
          <Button
            key={level}
            role="radio"
            aria-checked={current === level}
            size="sm"
            variant={current === level ? "secondary" : "ghost"}
            className="flex-1"
            disabled={locked}
            onClick={() => void apply(patchForLevel(level as BlurLevel))}
          >
            {label}
          </Button>
        ))}
      </div>
      {locked ? (
        <p className="text-[10px] leading-relaxed text-amber-400/90">
          Motion blur is read from the main composition. Open it to change this setting.
        </p>
      ) : null}
      {!locked && elementTarget && elementSettings ? (
        <div className="mt-1 flex flex-col gap-2 border-t border-neutral-800 pt-3">
          <span className="text-[11px] font-medium text-neutral-200">This element</span>
          <div role="radiogroup" aria-label="Element motion blur" className="flex gap-1.5">
            {ELEMENT_BLUR_MODES.map(({ mode, label }) => (
              <Button
                key={mode}
                role="radio"
                aria-checked={elementSettings.mode === mode}
                size="sm"
                variant={elementSettings.mode === mode ? "secondary" : "ghost"}
                className="flex-1"
                onClick={() => void applyElement({ mode })}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-[10px] text-neutral-400">
            <span>Shutter (°)</span>
            <input
              key={`${elementTarget.id}:${elementSettings.shutterDeg ?? ""}`}
              type="number"
              aria-label="Element shutter angle"
              min={MOTION_BLUR_LIMITS.shutterDeg.min}
              max={MOTION_BLUR_LIMITS.shutterDeg.max}
              placeholder={String(settings.shutterDeg)}
              defaultValue={
                elementSettings.shutterDeg === null ? "" : String(elementSettings.shutterDeg)
              }
              onBlur={(e) => {
                const input = e.currentTarget;
                commitShutterDraft(input.value, (next) => {
                  input.value = next;
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const input = e.currentTarget;
                  commitShutterDraft(input.value, (next) => {
                    input.value = next;
                  });
                }
              }}
              className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-[11px] text-neutral-100 outline-none focus:border-neutral-500"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
});
