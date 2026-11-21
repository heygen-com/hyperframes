import { wallSetTimeout } from "./wallClock";
import { swallow } from "./diagnostics";
import { isStylableElement } from "./domRealm";
import { servedToAnotherSite, type PreviewTarget } from "../studioPreviewMark";
import type { HfColorGradingTarget } from "../colorGrading";
import type { RuntimeBridgeControlMessage, RuntimeOutboundMessage } from "./types";
import {
  inspectRuntimeProtocol,
  runtimeProtocolFpsToNumber,
  runtimeProtocolMetadata,
  type RuntimeProtocolV1,
} from "./protocol";

type BridgeDeps = {
  onPlay: () => void;
  onPause: () => void;
  onStopMedia: () => void;
  onSeek: (timeSeconds: number, seekMode: "drag" | "commit") => void;
  onTick: () => void;
  onSetMuted: (muted: boolean) => void;
  onSetVolume: (volume: number) => void;
  onSetMediaOutputMuted: (muted: boolean) => void;
  onSetNativeMediaSyncDisabled: (disabled: boolean) => void;
  onSetWebAudioMediaDisabled: (disabled: boolean) => void;
  onSetPlaybackRate: (rate: number) => void;
  onSetIdleHeartbeat: (slow: boolean) => void;
  onSetRootDuration: (durationSeconds: number) => void;
  onSetPlayRange: (startSeconds: number, endSeconds: number | null) => void;
  onSetColorGrading: (target: HfColorGradingTarget | string | null, grading: unknown) => void;
  onSetColorGradingCompare: (
    target: HfColorGradingTarget | string | null,
    compare: unknown,
  ) => void;
  onEnablePickMode: () => void;
  onDisablePickMode: () => void;
  onSetRuntimeData?: (channel: string, payload: unknown, requestId?: number) => void;
  onClearRuntimeData?: (channel: string, requestId?: number) => void;
  onSetDisplayScale?: (scale: number) => void;
  onSetPreviewQuality?: (level: number) => void;
  onSetCopiesAhead?: (on: boolean) => void;
  onRetryPreviewCopies?: () => void;
  onRequestPreviewFacts?: () => void;
  onScrubAudio?: (target: PreviewTarget | null, time: number | null, volume: number) => void;
  getCanonicalFps: () => number;
};

let runtimeProtocolFps = 30;

export function setRuntimeProtocolFps(fps: number): void {
  runtimeProtocolFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
}

// Another site framing the page learns only how playback stands: the timeline and the picker describe the composition.
const ANOTHER_SITE_SEES = new Set<string>(["ready", "state", "stage-size"]);
const ANOTHER_SITE_DRIVES = new Set<string>([
  "play",
  "pause",
  "stop-media",
  "seek",
  "tick",
  "set-muted",
  "set-volume",
  "set-media-output-muted",
  "set-playback-rate",
  "set-idle-heartbeat",
  "set-display-scale",
]);

let markedForAnotherSite = false;
const forAnotherSite = (): boolean =>
  (markedForAnotherSite ||= typeof document !== "undefined" && servedToAnotherSite(document));

export function postRuntimeMessage(payload: RuntimeOutboundMessage): void {
  if (forAnotherSite() && !ANOTHER_SITE_SEES.has(payload.type)) return;
  try {
    window.parent.postMessage({ ...payload, ...runtimeProtocolMetadata(runtimeProtocolFps) }, "*");
  } catch (err) {
    // Cross-frame posting can throw if the parent is gone or origin-isolated.
    swallow("bridge.postMessage", err);
  }
}

type BridgeControlData = Partial<RuntimeBridgeControlMessage & RuntimeProtocolV1>;
type ControlHandler = (data: BridgeControlData, deps: BridgeDeps) => void;

const FLASH_DEFAULT_DURATION_MS = 800;
const FLASH_MAX_DURATION_MS = 5000;
const MAX_FLASH_SELECTORS = 100;
const MAX_SELECTOR_LENGTH = 1000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Absent (null or undefined) yields the fallback, a finite number yields itself,
// and any other value yields null so the caller drops the message.
function readNumber(value: unknown, fallback: number): number | null {
  if (value == null) return fallback;
  return isFiniteNumber(value) ? value : null;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SELECTOR_LENGTH;
}

function isOptionalBoundedString(value: unknown): boolean {
  return value == null || isBoundedString(value);
}

function isGradingTarget(value: unknown): value is HfColorGradingTarget | string | null {
  if (value === null || isBoundedString(value)) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return (
    isOptionalBoundedString(target.id) &&
    isOptionalBoundedString(target.hfId) &&
    isOptionalBoundedString(target.selector) &&
    (target.selectorIndex == null || isFiniteNumber(target.selectorIndex))
  );
}

function isScrubTarget(value: unknown): value is PreviewTarget | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return (
    isBoundedString(target.id) &&
    isOptionalBoundedString(target.hfId) &&
    isOptionalBoundedString(target.domId) &&
    isOptionalBoundedString(target.sourceFile)
  );
}

function dispatchScrubAudio(data: BridgeControlData, deps: BridgeDeps): void {
  const target = data.target ?? null;
  if (!isScrubTarget(target)) return;
  if (data.time === null) return deps.onScrubAudio?.(target, null, 0);
  if (!isFiniteNumber(data.time) || !isFiniteNumber(data.volume)) return;
  deps.onScrubAudio?.(target, Math.max(0, data.time), Math.max(0, Math.min(1, data.volume)));
}

function dispatchColorGrading(
  target: unknown,
  value: unknown,
  apply: (target: HfColorGradingTarget | string | null, value: unknown) => void,
): void {
  const resolvedTarget = target ?? null;
  if (isGradingTarget(resolvedTarget)) apply(resolvedTarget, value ?? null);
}

// Per-action dispatchers. Splitting the handler into a lookup table keeps the
// top-level message listener trivial (one map lookup), and each action's logic
// becomes individually testable / inheritable for fallow's CRAP analysis.
// Each dispatcher checks its payload fields for type and range and drops the
// message when a field is invalid.
const CONTROL_HANDLERS = new Map<string, ControlHandler>(
  Object.entries({
    play: (_d, deps) => deps.onPlay(),
    pause: (_d, deps) => deps.onPause(),
    "stop-media": (_d, deps) => deps.onStopMedia(),
    seek: (data, deps) => {
      const timeSeconds = resolveSeekTimeSeconds(data, deps);
      if (timeSeconds !== null)
        deps.onSeek(timeSeconds, data.seekMode === "drag" ? "drag" : "commit");
    },
    tick: (_d, deps) => deps.onTick(),
    "set-muted": (data, deps) => deps.onSetMuted(data.muted === true),
    "set-volume": (data, deps) => {
      const volume = readNumber(data.volume, 1);
      if (volume !== null) deps.onSetVolume(Math.max(0, Math.min(1, volume)));
    },
    "set-media-output-muted": (data, deps) => deps.onSetMediaOutputMuted(data.muted === true),
    "set-native-media-sync-disabled": (data, deps) =>
      deps.onSetNativeMediaSyncDisabled(data.disabled === true),
    "set-web-audio-media-disabled": (data, deps) =>
      deps.onSetWebAudioMediaDisabled(data.disabled === true),
    "set-playback-rate": (data, deps) => {
      const rate = readNumber(data.playbackRate, 1);
      if (rate !== null) deps.onSetPlaybackRate(rate);
    },
    "set-idle-heartbeat": (data, deps) => deps.onSetIdleHeartbeat(data.slow === true),
    "set-display-scale": (data, deps) => {
      if (isFiniteNumber(data.scale) && data.scale > 0) deps.onSetDisplayScale?.(data.scale);
    },
    "set-preview-quality": (data, deps) => {
      if (isFiniteNumber(data.level)) deps.onSetPreviewQuality?.(data.level);
    },
    "set-copies-ahead": (data, deps) => deps.onSetCopiesAhead?.(data.on === true),
    "retry-preview-copies": (_d, deps) => deps.onRetryPreviewCopies?.(),
    "request-preview-facts": (_d, deps) => deps.onRequestPreviewFacts?.(),
    "set-root-duration": (data, deps) => {
      const durationSeconds = readNumber(data.durationSeconds, 0);
      if (durationSeconds !== null) deps.onSetRootDuration(durationSeconds);
    },
    "set-play-range": (data, deps) => {
      const startSeconds = readNumber(data.startSeconds, 0);
      const endSeconds = data.endSeconds ?? null;
      if (startSeconds === null || (endSeconds !== null && !isFiniteNumber(endSeconds))) return;
      deps.onSetPlayRange(startSeconds, endSeconds);
    },
    "set-color-grading": (data, deps) =>
      dispatchColorGrading(data.target, data.grading, deps.onSetColorGrading),
    "set-color-grading-compare": (data, deps) =>
      dispatchColorGrading(data.target, data.compare, deps.onSetColorGradingCompare),
    "enable-pick-mode": (_d, deps) => deps.onEnablePickMode(),
    "disable-pick-mode": (_d, deps) => deps.onDisablePickMode(),
    "flash-elements": (data) => handleFlashElements(data),
    "scrub-audio": dispatchScrubAudio,
    "set-runtime-data": (data, deps) => {
      if (typeof data.channel === "string")
        deps.onSetRuntimeData?.(data.channel, data.payload, data.requestId);
    },
    "clear-runtime-data": (data, deps) => {
      if (typeof data.channel === "string") deps.onClearRuntimeData?.(data.channel, data.requestId);
    },
  } satisfies Record<string, ControlHandler>),
);

function resolveSeekTimeSeconds(data: BridgeControlData, deps: BridgeDeps): number | null {
  if (data.timeSeconds != null) {
    return isFiniteNumber(data.timeSeconds) ? Math.max(0, data.timeSeconds) : null;
  }
  const frame = readNumber(data.frame, 0);
  if (frame === null) return null;
  const messageFps = runtimeProtocolFpsToNumber(data.fps);
  const fps = messageFps ?? deps.getCanonicalFps();
  return Math.max(0, frame) / fps;
}

function rejectUnsupportedProtocol(data: BridgeControlData): boolean {
  const protocol = inspectRuntimeProtocol(data);
  if (protocol.status !== "unsupported") return false;
  postRuntimeMessage({
    source: "hf-preview",
    type: "diagnostic",
    code: `runtime.protocol.${protocol.code}`,
    details: {
      receivedVersion:
        typeof protocol.receivedVersion === "string" || typeof protocol.receivedVersion === "number"
          ? protocol.receivedVersion
          : null,
    },
  });
  return true;
}

function readFlashSelectors(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_FLASH_SELECTORS) return null;
  return value.every(isBoundedString) ? value : null;
}

function handleFlashElements(data: BridgeControlData): void {
  // Briefly highlight elements — used by the chat-canvas bridge
  // to show what changed after an agent edit
  const fields = data as Record<string, unknown>;
  const selectors = readFlashSelectors(fields.selectors);
  const duration = readNumber(fields.duration, FLASH_DEFAULT_DURATION_MS);
  if (!selectors || duration === null || duration <= 0 || duration > FLASH_MAX_DURATION_MS) return;
  flashElements(selectors, duration);
}

function isActionTakenHere(action: unknown): action is string {
  return typeof action === "string" && (!forAnotherSite() || ANOTHER_SITE_DRIVES.has(action));
}

export function installRuntimeControlBridge(deps: BridgeDeps): (event: MessageEvent) => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window.parent && event.source !== window) return;
    const data = event.data as BridgeControlData | null;
    if (!data || data.source !== "hf-parent" || data.type !== "control") return;
    if (rejectUnsupportedProtocol(data)) return;
    const action = data.action;
    if (!isActionTakenHere(action)) return;
    const fn = CONTROL_HANDLERS.get(action);
    if (fn) fn(data, deps);
  };
  window.addEventListener("message", handler);
  // Announce that the bridge listener is installed so the parent can replay
  // any control messages it posted before the iframe runtime was ready
  // (avoids losing the initial `set-muted` / `set-volume` / `set-playback-rate`
  // when the parent finishes loading before the iframe does — a deterministic
  // race on warm-cache reloads and inside the Claude desktop Electron client).
  postRuntimeMessage({ source: "hf-preview", type: "ready" });
  return handler;
}

const FLASH_STYLE_RULES = `
  .__hf-flash {
    outline: 2px solid rgba(59, 130, 246, 0.6) !important;
    outline-offset: 2px !important;
    animation: __hf-flash-pulse var(--hf-flash-duration, 800ms) ease-out forwards !important;
  }
  @keyframes __hf-flash-pulse {
    0% { outline-color: rgba(59, 130, 246, 0.8); }
    100% { outline-color: transparent; }
  }
`;

/**
 * Flash elements — briefly highlight them with a blue outline.
 * Used by the chat-canvas bridge to show what changed after an agent edit.
 */
function flashElements(selectors: string[], duration: number): void {
  if (!document.getElementById("__hf-flash-styles")) {
    const style = document.createElement("style");
    style.id = "__hf-flash-styles";
    style.textContent = FLASH_STYLE_RULES;
    document.head.appendChild(style);
  }

  for (const selector of selectors) {
    try {
      const els = document.querySelectorAll(selector);
      els.forEach((el) => {
        if (isStylableElement(el)) el.style.setProperty("--hf-flash-duration", `${duration}ms`);
        el.classList.add("__hf-flash");
        wallSetTimeout(() => el.classList.remove("__hf-flash"), duration);
      });
    } catch (err) {
      // Invalid selector — skip
      swallow("bridge.flashElements.querySelector", err);
    }
  }
}
