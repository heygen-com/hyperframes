import { useEffect, useState } from "react";
import { Check, ClipboardList } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import {
  type BackgroundRemovalProgress,
  type BackgroundRemovalResult,
  stripQueryAndHash,
} from "./propertyPanelHelpers";
import { FlatSelectRow, FlatToggle } from "./propertyPanelFlatPrimitives";

// fallow-ignore-next-line complexity
export function FlatMediaSection({
  projectDir,
  element,
  // oxlint-disable-next-line no-unused-vars -- wired into the Fit/Position rows in Task 6
  styles,
  // oxlint-disable-next-line no-unused-vars -- wired into the Fit/Position rows in Task 6
  onSetStyle,
  onSetAttribute,
  onSetHtmlAttribute,
  onRemoveBackground,
}: {
  projectDir: string | null;
  element: DomEditSelection;
  styles: Record<string, string>;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetHtmlAttribute: (attr: string, value: string | null) => void | Promise<void>;
  onRemoveBackground?: (
    inputPath: string,
    options: {
      createBackgroundPlate?: boolean;
      quality?: "fast" | "balanced" | "best";
      onProgress?: (progress: BackgroundRemovalProgress) => void;
    },
  ) => Promise<BackgroundRemovalResult>;
}) {
  const isVideo = element.tagName === "video";
  // oxlint-disable-next-line no-unused-vars -- wired into the Volume/Rate/Muted gate in Task 4
  const isAudio = element.tagName === "audio";
  const isImage = element.tagName === "img";
  const isVisualMedia = isVideo || isImage;
  const el = element.element;

  const srcAttr = el.getAttribute("src") ?? "";
  const [copied, setCopied] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeProgress, setRemoveProgress] = useState<BackgroundRemovalProgress | null>(null);
  const [createPlate, setCreatePlate] = useState(false);
  const [quality, setQuality] = useState<"fast" | "balanced" | "best">("balanced");

  const absoluteSrc =
    projectDir && srcAttr && !srcAttr.startsWith("http") ? `${projectDir}/${srcAttr}` : srcAttr;
  const projectSrc =
    srcAttr && !/^(?:https?:|data:|blob:)/i.test(srcAttr)
      ? stripQueryAndHash(srcAttr.startsWith("./") ? srcAttr.slice(2) : srcAttr)
      : "";
  const canRemoveBackground = Boolean(onRemoveBackground && isVisualMedia && projectSrc);

  useEffect(() => {
    setRemoveProgress(null);
    setCreatePlate(false);
  }, [srcAttr]);

  const applyCutoutResult = async (result: BackgroundRemovalResult) => {
    await onSetHtmlAttribute("src", result.outputPath);
    if (isVideo) {
      await onSetAttribute("has-audio", "");
      await onSetHtmlAttribute("muted", "true");
    }
  };

  const runBackgroundRemoval = async () => {
    if (!onRemoveBackground || !projectSrc || removeBusy) return;
    setRemoveBusy(true);
    setRemoveProgress({ status: "processing", progress: 0, stage: "Preparing" });
    try {
      const result = await onRemoveBackground(projectSrc, {
        createBackgroundPlate: isVideo && createPlate,
        quality,
        onProgress: setRemoveProgress,
      });
      await applyCutoutResult(result);
      setRemoveProgress({ status: "complete", progress: 100, stage: "Applied cutout", ...result });
    } catch (error) {
      setRemoveProgress({
        status: "failed",
        progress: 0,
        stage: "Failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-5 w-8 flex-shrink-0 rounded-[3px] bg-panel-surface" />
          <span className="min-w-0 truncate font-mono text-[11px] text-panel-text-0">
            {srcAttr}
          </span>
        </span>
        <button
          type="button"
          data-flat-media-copy="true"
          onClick={() => {
            void navigator.clipboard.writeText(absoluteSrc).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex flex-shrink-0 items-center gap-1 text-[10px] text-panel-text-3 hover:text-panel-text-1"
        >
          {copied ? <Check size={11} /> : <ClipboardList size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {isVisualMedia && (
        <div className="ml-[1px] border-l-2 border-panel-border-input py-1 pl-[10px]">
          <div className="flex min-h-6 items-center justify-between">
            <span className="flex items-baseline gap-[7px]">
              <span className="text-[11px] font-semibold text-panel-text-1">Cutout</span>
              <span className="font-mono text-[9px] text-panel-text-4">
                transparent {isVideo ? "WebM" : "PNG"}
              </span>
            </span>
            <button
              type="button"
              data-flat-media-remove-bg="true"
              disabled={!canRemoveBackground || removeBusy}
              onClick={() => void runBackgroundRemoval()}
              className="flex items-center gap-1 text-[10px] font-medium text-panel-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={
                canRemoveBackground
                  ? "Remove background and save a transparent asset"
                  : "Select a project-local image or video asset"
              }
            >
              {removeBusy ? "Working" : "Remove BG"}
            </button>
          </div>
          <FlatSelectRow
            label="Quality"
            value={quality}
            options={["fast", "balanced", "best"]}
            tier="explicitDefault"
            onChange={(next) => setQuality(next as typeof quality)}
          />
          {isVideo && (
            <FlatToggle label="BG plate" checked={createPlate} onChange={setCreatePlate} />
          )}
          {removeProgress && (
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-panel-text-4">
                <span className="min-w-0 flex-1 truncate">
                  {removeProgress.error ?? removeProgress.stage ?? "Processing"}
                </span>
                <span>{Math.round(removeProgress.progress)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-panel-hover">
                <div
                  className={`h-full rounded-full ${
                    removeProgress.status === "failed" ? "bg-red-400" : "bg-panel-accent"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, removeProgress.progress))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
