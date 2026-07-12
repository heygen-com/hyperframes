import { useEffect, useState } from "react";
import { Check, ClipboardList, Film, Music, Scissors } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import {
  type BackgroundRemovalProgress,
  type BackgroundRemovalResult,
  formatNumericValue,
  formatTimingValue,
  LABEL,
  parseNumericValue,
  RESPONSIVE_GRID,
  stripQueryAndHash,
} from "./propertyPanelHelpers";
import { Section, SegmentedControl, SelectField, SliderControl } from "./propertyPanelPrimitives";

// fallow-ignore-next-line complexity
export function MediaSection({
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

  const hasLoop = el.hasAttribute("loop");
  const hasMuted = el.hasAttribute("muted");
  const hasAudio = element.dataAttributes["has-audio"] === "true";

  const playbackRate = Number.parseFloat(element.dataAttributes["playback-rate"] ?? "1") || 1;

  const objectFit = styles["object-fit"] || "contain";
  const objectPosition = styles["object-position"] || "center";

  const sourceDuration =
    Number.parseFloat(element.dataAttributes["source-duration"] ?? "") ||
    (el as HTMLMediaElement).duration ||
    0;
  const mediaStartMax = Math.max(30, Math.ceil(sourceDuration || mediaStart + 10));

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
  const panelTitle = isImage ? "Image" : isVideo ? "Video" : "Audio";

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
      setRemoveProgress({
        status: "complete",
        progress: 100,
        stage: "Applied cutout",
        ...result,
      });
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
    <Section title={panelTitle} icon={isAudio ? <Music size={15} /> : <Film size={15} />}>
      <div className="space-y-4">
        {srcAttr && (
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium text-neutral-500">Source</div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(absoluteSrc).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="flex h-6 items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-[10px] font-medium text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200"
              >
                {copied ? <Check size={11} /> : <ClipboardList size={11} />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <div
              className="mt-1 truncate text-[11px] font-medium text-neutral-300"
              title={absoluteSrc}
            >
              {absoluteSrc}
            </div>
          </div>
        )}

        {isVisualMedia && (
          <div className="grid min-w-0 max-w-full gap-2 overflow-hidden rounded-md bg-panel-input/30 p-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <div className={LABEL}>Cutout</div>
                <div className="mt-0.5 truncate text-[10px] text-panel-text-4">
                  Create transparent {isVideo ? "WebM video" : "PNG image"}
                </div>
              </div>
              <button
                type="button"
                disabled={!canRemoveBackground || removeBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  void runBackgroundRemoval();
                }}
                className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md bg-panel-input px-2.5 text-[11px] font-medium text-panel-text-2 transition-colors hover:bg-panel-hover hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  canRemoveBackground
                    ? "Remove background and save a transparent asset"
                    : "Select a project-local image or video asset"
                }
              >
                <Scissors size={13} />
                <span>{removeBusy ? "Working" : "Remove BG"}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Quality"
                value={quality}
                onChange={(next) => setQuality(next as typeof quality)}
                options={["fast", "balanced", "best"]}
              />
              {isVideo ? (
                <div className="grid min-w-0 gap-1.5">
                  <span className={LABEL}>BG plate</span>
                  <SegmentedControl
                    value={createPlate ? "on" : "off"}
                    onChange={(next) => setCreatePlate(next === "on")}
                    options={[
                      { label: "On", value: "on" },
                      { label: "Off", value: "off" },
                    ]}
                  />
                  <span className="text-[10px] leading-tight text-panel-text-4">
                    Optional hole-cut background copy.
                  </span>
                </div>
              ) : (
                <div />
              )}
            </div>

            {removeProgress && (
              <div className="space-y-1">
                <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-panel-text-4">
                  <span className="min-w-0 flex-1 truncate">
                    {removeProgress.error ?? removeProgress.stage ?? "Processing"}
                  </span>
                  <span>{Math.round(removeProgress.progress)}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-panel-border">
                  <div
                    className={`h-full rounded-full ${
                      removeProgress.status === "failed" ? "bg-red-400" : "bg-studio-accent"
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, removeProgress.progress))}%` }}
                  />
                </div>
              </div>
            )}

            {removeProgress?.status === "complete" && removeProgress.outputPath && (
              <div
                className="truncate text-[10px] font-medium text-panel-text-3"
                title={removeProgress.outputPath}
              >
                Applied {removeProgress.outputPath}
              </div>
            )}
          </div>
        )}

        {(isVideo || isAudio) && (
          <>
            <div className="grid min-w-0 gap-1.5">
              <span className={LABEL}>Volume</span>
              <SliderControl
                value={volumePercent}
                min={0}
                max={100}
                step={1}
                displayValue={`${volumePercent}%`}
                formatDisplayValue={(next) => `${Math.round(next)}%`}
                onCommit={(next) => {
                  void onSetAttribute("volume", formatNumericValue(next / 100));
                }}
              />
            </div>

            <div className="grid min-w-0 gap-1.5">
              <span className={LABEL}>Playback rate</span>
              <SliderControl
                value={playbackRate * 100}
                min={25}
                max={300}
                step={5}
                displayValue={`${formatNumericValue(playbackRate)}x`}
                formatDisplayValue={(next) => `${formatNumericValue(next / 100)}x`}
                onCommit={(next) => {
                  void onSetAttribute("playback-rate", formatNumericValue(next / 100));
                }}
              />
            </div>

            <div className="grid min-w-0 gap-1.5">
              <span className={LABEL}>Media start</span>
              <SliderControl
                value={Math.round(mediaStart * 100)}
                min={0}
                max={mediaStartMax * 100}
                step={10}
                displayValue={formatTimingValue(mediaStart)}
                formatDisplayValue={(next) => formatTimingValue(next / 100)}
                onCommit={(next) => {
                  void onSetAttribute("media-start", (next / 100).toFixed(2));
                }}
              />
            </div>

            <div className={RESPONSIVE_GRID}>
              <div className="grid min-w-0 gap-1.5">
                <span className={LABEL}>Loop</span>
                <SegmentedControl
                  value={hasLoop ? "on" : "off"}
                  onChange={(next) => {
                    void onSetHtmlAttribute("loop", next === "on" ? "true" : null);
                  }}
                  options={[
                    { label: "On", value: "on" },
                    { label: "Off", value: "off" },
                  ]}
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <span className={LABEL}>Muted</span>
                <SegmentedControl
                  value={hasMuted ? "on" : "off"}
                  onChange={(next) => {
                    void onSetHtmlAttribute("muted", next === "on" ? "true" : null);
                  }}
                  options={[
                    { label: "On", value: "on" },
                    { label: "Off", value: "off" },
                  ]}
                />
              </div>
            </div>

            {isVideo && (
              <div className="grid min-w-0 gap-1.5">
                <span className={LABEL}>Has audio track</span>
                <SegmentedControl
                  value={hasAudio ? "yes" : "no"}
                  onChange={(next) => {
                    if (next === "yes") {
                      void onSetAttribute("has-audio", "true");
                      void onSetHtmlAttribute("muted", null);
                    } else {
                      void onSetAttribute("has-audio", "");
                      void onSetHtmlAttribute("muted", "true");
                    }
                  }}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {isVisualMedia && (
          <>
            <div className={RESPONSIVE_GRID}>
              <SelectField
                label="Fit"
                value={objectFit}
                onChange={(next) => {
                  void onSetStyle("object-fit", next);
                }}
                options={["contain", "cover", "fill", "none", "scale-down"]}
              />
              <SelectField
                label="Position"
                value={objectPosition}
                onChange={(next) => {
                  void onSetStyle("object-position", next);
                }}
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
              />
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
