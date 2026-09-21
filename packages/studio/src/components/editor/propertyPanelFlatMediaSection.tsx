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
import { AutomationToggle } from "./propertyPanelFxControls";
import { RATE_RANGE } from "@hyperframes/core/audio-automation";
import { type SpeedPresetId } from "@hyperframes/core/speed-ramp";
import { SPEED_PRESET_OPTIONS, type RateBinding } from "./useVolumeAutomation";
import { fromUnit, toUnit } from "../../player/components/automationLaneGeometry";
import {
  AUDIO_GAIN_FADER_MAX,
  AUDIO_GAIN_FADER_MIN,
  audioFaderPositionToGain,
  formatAudioGain,
  audioGainToFaderPosition,
  audioGainToText,
} from "@hyperframes/core/audio-gain";
import {
  HF_AUDIO_FADE_IN_DATA_KEY,
  HF_AUDIO_FADE_OUT_DATA_KEY,
  formatFadeSeconds,
  readFadeSeconds,
} from "@hyperframes/core/audio-fade";
import { parseGainInput, parseRateInput, parseSecondsInput } from "./audioInspectorInput";

// fallow-ignore-next-line complexity
export function FlatMediaSection({
  projectDir,
  element,
  styles,
  onSetStyle,
  onSetAttribute,
  onSetHtmlAttribute,
  onRemoveBackground,
  volumeAutomated,
  onAutomateVolume,
  onRemoveVolumeAutomation,
  onCommitVolumeAt,
  automatedVolumeValue,
  rate,
}: {
  projectDir: string | null;
  element: DomEditSelection;
  styles: Record<string, string>;
  onSetStyle: (prop: string, value: string) => void | Promise<unknown>;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
  onSetHtmlAttribute: (attr: string, value: string | null) => void | Promise<void>;
  /** A volume lane in the timeline drives the level; the slider writes a keyframe instead. */
  volumeAutomated?: boolean;
  onAutomateVolume?: () => void;
  onRemoveVolumeAutomation?: () => void;
  onCommitVolumeAt?: (v: number) => void;
  automatedVolumeValue?: number;
  /** Speed lane binding and presets; absent outside the Studio panel. */
  rate?: RateBinding;
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

  // While a lane owns the level, the envelope's live value at the playhead is
  // what the slider must show — the static attribute is only what the engine
  // falls back to outside automation.
  const volume =
    volumeAutomated && automatedVolumeValue !== undefined
      ? automatedVolumeValue
      : (parseNumericValue(element.dataAttributes.volume ?? "") ?? 1);
  const volumeFaderPosition = audioGainToFaderPosition(volume);
  const mediaStart =
    Number.parseFloat(
      element.dataAttributes["media-start"] ?? element.dataAttributes["playback-start"] ?? "0",
    ) || 0;
  const constantRate = Number.parseFloat(element.dataAttributes["playback-rate"] ?? "1") || 1;
  const playbackRate =
    rate?.automated && rate.automatedValue !== undefined ? rate.automatedValue : constantRate;
  const sourceDuration =
    Number.parseFloat(element.dataAttributes["source-duration"] ?? "") ||
    (el as HTMLMediaElement).duration ||
    0;
  const mediaStartMax = Math.max(30, Math.ceil(sourceDuration || mediaStart + 10));
  const fadeIn = readFadeSeconds(element.dataAttributes[HF_AUDIO_FADE_IN_DATA_KEY]);
  const fadeOut = readFadeSeconds(element.dataAttributes[HF_AUDIO_FADE_OUT_DATA_KEY]);
  const clipDuration = Number.parseFloat(element.dataAttributes.duration ?? "") || 0;
  // A fade cannot outrun the clip; without a known duration, offer 10 s.
  const fadeMax = clipDuration > 0 ? clipDuration : 10;
  const fadeText = (seconds: number) => (seconds > 0 ? formatFadeSeconds(seconds) : "");
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
          <span className="h-5 w-8 shrink-0 rounded-[3px] bg-panel-surface" />
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
          className="flex shrink-0 items-center gap-1 text-[10px] text-panel-text-3 hover:text-panel-text-1"
        >
          {copied ? <Check size={11} /> : <ClipboardList size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {isVisualMedia && (
        <div className="ml-px border-l-2 border-panel-border-input py-1 pl-[10px]">
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
          {/* While a lane owns the level, a commit writes a keyframe at the
              playhead instead of the plain attribute — same slider, same
              gesture, the write just goes through the envelope. */}
          <div
            className="hf-volume-row flex items-center gap-1"
            data-volume-automated={volumeAutomated ? "" : undefined}
          >
            <div className="min-w-0 flex-1">
              <FlatSlider
                label="Volume"
                value={volumeFaderPosition}
                min={AUDIO_GAIN_FADER_MIN}
                max={AUDIO_GAIN_FADER_MAX}
                tier={volume === 1 ? "default" : "explicitCustom"}
                displayValue={audioGainToText(volume)}
                centerTick
                onCommit={(next) => {
                  const gain = audioFaderPositionToGain(next);
                  if (volumeAutomated) {
                    onCommitVolumeAt?.(gain);
                  } else {
                    void onSetAttribute("volume", formatAudioGain(gain));
                  }
                }}
                onCommitText={(text) => {
                  const gain = parseGainInput(text);
                  if (gain === null) return false;
                  if (volumeAutomated) onCommitVolumeAt?.(gain);
                  else void onSetAttribute("volume", formatAudioGain(gain));
                  return true;
                }}
              />
            </div>
            <AutomationToggle
              paramKey="volume"
              label="Volume"
              automated={Boolean(volumeAutomated)}
              onAutomate={onAutomateVolume ? () => onAutomateVolume() : undefined}
              onRemoveAutomation={
                onRemoveVolumeAutomation ? () => onRemoveVolumeAutomation() : undefined
              }
            />
          </div>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <FlatSlider
                label="Speed"
                value={Math.round(toUnit(RATE_RANGE, playbackRate) * 1000)}
                min={0}
                max={1000}
                tier={playbackRate === 1 ? "default" : "explicitCustom"}
                displayValue={`${formatNumericValue(playbackRate)}x`}
                onCommit={(next) => {
                  const speed = fromUnit(RATE_RANGE, next / 1000);
                  if (rate?.automated) {
                    rate.onCommitAt(speed);
                  } else {
                    void onSetAttribute("playback-rate", formatNumericValue(speed));
                  }
                }}
                onCommitText={(text) => {
                  const speed = parseRateInput(text);
                  if (speed === null) return false;
                  if (rate?.automated) rate.onCommitAt(speed);
                  else void onSetAttribute("playback-rate", formatNumericValue(speed));
                  return true;
                }}
              />
            </div>
            <AutomationToggle
              paramKey="rate"
              label="Speed"
              automated={Boolean(rate?.automated)}
              onAutomate={rate ? () => rate.onAutomate() : undefined}
              onRemoveAutomation={rate ? () => rate.onRemoveAutomation() : undefined}
            />
          </div>
          {/* Speed presets are picture-driven ramps (slow-mo reveals, whip
              speed-ups); on a bare audio clip they only warp pitch, so the
              row is video-only. */}
          {rate?.canApplyPreset && !isAudio && (
            <FlatSelectRow
              label="Speed preset"
              value=""
              options={[{ value: "", label: "Choose…" }, ...SPEED_PRESET_OPTIONS]}
              tier="default"
              onChange={(id) => id && rate.onApplyPreset(id as SpeedPresetId)}
            />
          )}
          <FlatSlider
            label="Media start"
            value={Math.round(mediaStart * 100)}
            min={0}
            max={mediaStartMax * 100}
            tier={mediaStart === 0 ? "default" : "explicitCustom"}
            displayValue={formatTimingValue(mediaStart)}
            onCommit={(next) => void onSetAttribute("media-start", (next / 100).toFixed(2))}
            onCommitText={(text) => {
              const seconds = parseSecondsInput(text);
              if (seconds === null) return false;
              void onSetAttribute("media-start", seconds.toFixed(2));
              return true;
            }}
          />
          {(isAudio || hasAudio) && (
            <>
              {/* Clip-edge fades: `data-fade-in` / `data-fade-out`, seconds.
                  The same two numbers the timeline's corner handles drag; an
                  empty write removes the attribute. */}
              <FlatSlider
                label="Fade in"
                value={Math.round(fadeIn * 100)}
                min={0}
                max={Math.round(fadeMax * 100)}
                tier={fadeIn === 0 ? "default" : "explicitCustom"}
                displayValue={formatTimingValue(fadeIn)}
                onCommit={(next) =>
                  void onSetAttribute(HF_AUDIO_FADE_IN_DATA_KEY, fadeText(next / 100))
                }
                onCommitText={(text) => {
                  const seconds = parseSecondsInput(text);
                  if (seconds === null) return false;
                  void onSetAttribute(HF_AUDIO_FADE_IN_DATA_KEY, fadeText(seconds));
                  return true;
                }}
                onReset={
                  fadeIn > 0 ? () => void onSetAttribute(HF_AUDIO_FADE_IN_DATA_KEY, "") : undefined
                }
              />
              <FlatSlider
                label="Fade out"
                value={Math.round(fadeOut * 100)}
                min={0}
                max={Math.round(fadeMax * 100)}
                tier={fadeOut === 0 ? "default" : "explicitCustom"}
                displayValue={formatTimingValue(fadeOut)}
                onCommit={(next) =>
                  void onSetAttribute(HF_AUDIO_FADE_OUT_DATA_KEY, fadeText(next / 100))
                }
                onCommitText={(text) => {
                  const seconds = parseSecondsInput(text);
                  if (seconds === null) return false;
                  void onSetAttribute(HF_AUDIO_FADE_OUT_DATA_KEY, fadeText(seconds));
                  return true;
                }}
                onReset={
                  fadeOut > 0
                    ? () => void onSetAttribute(HF_AUDIO_FADE_OUT_DATA_KEY, "")
                    : undefined
                }
              />
            </>
          )}
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
