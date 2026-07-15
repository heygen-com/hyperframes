import { useEffect, useState } from "react";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { Check, ClipboardList } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import {
  type BackgroundRemovalProgress,
  type BackgroundRemovalResult,
  formatNumericValue,
  formatTimingValue,
  parseNumericValue,
  stripQueryAndHash,
} from "./propertyPanelHelpers";
import { FlatSelectRow, FlatSlider } from "./propertyPanelFlatPrimitives";
import { FlatToggle } from "./propertyPanelFlatToggle";

// fallow-ignore-next-line complexity
export function FlatMediaSection({
  projectDir,
  element,
  styles,
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
  const track = useTrackDesignInput();
  const isVideo = element.tagName === "video";
  const isAudio = element.tagName === "audio";
  const isImage = element.tagName === "img";
  const isVisualMedia = isVideo || isImage;
  const el = element.element;

  const volume = parseNumericValue(element.dataAttributes.volume ?? "") ?? 1;
  const volumePercent = Math.round(volume * 100);
  const mediaStart =
    Number.parseFloat(
      element.dataAttributes["media-start"] ?? element.dataAttributes["playback-start"] ?? "0",
    ) || 0;
  const playbackRate = Number.parseFloat(element.dataAttributes["playback-rate"] ?? "1") || 1;
  const sourceDuration =
    Number.parseFloat(element.dataAttributes["source-duration"] ?? "") ||
    (el as HTMLMediaElement).duration ||
    0;
  const mediaStartMax = Math.max(30, Math.ceil(sourceDuration || mediaStart + 10));
  const hasLoop = el.hasAttribute("loop");
  const hasMuted = el.hasAttribute("muted");
  const hasAudio = element.dataAttributes["has-audio"] === "true";
  const objectFit = styles["object-fit"] || "contain";
  const objectPosition = styles["object-position"] || "center";

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
    track("button", "Remove background");
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
            track("button", "Copy media path");
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
      {(isVideo || isAudio) && (
        <>
          <FlatSlider
            label="Volume"
            value={volumePercent}
            min={0}
            max={100}
            tier={volumePercent === 100 ? "default" : "explicitCustom"}
            displayValue={`${volumePercent}%`}
            onCommit={(next) => void onSetAttribute("volume", formatNumericValue(next / 100))}
          />
          <FlatSlider
            label="Rate"
            value={playbackRate * 100}
            min={25}
            max={300}
            tier={playbackRate === 1 ? "default" : "explicitCustom"}
            displayValue={`${formatNumericValue(playbackRate)}x`}
            onCommit={(next) =>
              void onSetAttribute("playback-rate", formatNumericValue(next / 100))
            }
          />
          <FlatSlider
            label="Media start"
            value={Math.round(mediaStart * 100)}
            min={0}
            max={mediaStartMax * 100}
            tier={mediaStart === 0 ? "default" : "explicitCustom"}
            displayValue={formatTimingValue(mediaStart)}
            onCommit={(next) => void onSetAttribute("media-start", (next / 100).toFixed(2))}
          />
          <FlatToggle
            label="Loop"
            checked={hasLoop}
            onChange={(next) => void onSetHtmlAttribute("loop", next ? "true" : null)}
          />
          <FlatToggle
            label="Muted"
            checked={hasMuted}
            onChange={(next) => void onSetHtmlAttribute("muted", next ? "true" : null)}
          />
          {isVideo && (
            <FlatToggle
              label="Has audio track"
              checked={hasAudio}
              onChange={(next) => {
                if (next) {
                  void onSetAttribute("has-audio", "true");
                  void onSetHtmlAttribute("muted", null);
                } else {
                  void onSetAttribute("has-audio", "");
                  void onSetHtmlAttribute("muted", "true");
                }
              }}
            />
          )}
        </>
      )}
      {isVisualMedia && (
        <>
          <FlatSelectRow
            label="Fit"
            value={objectFit}
            options={["contain", "cover", "fill", "none", "scale-down"]}
            tier={objectFit === "contain" ? "default" : "explicitCustom"}
            onChange={(next) => void onSetStyle("object-fit", next)}
          />
          <FlatSelectRow
            label="Position"
            value={objectPosition}
            options={[
              "center",
              "top",
              "bottom",
              "left",
              "right",
              "left top",
              "right top",
              "left bottom",
              "right bottom",
            ]}
            tier={objectPosition === "center" ? "default" : "explicitCustom"}
            onChange={(next) => void onSetStyle("object-position", next)}
          />
        </>
      )}
    </div>
  );
}
