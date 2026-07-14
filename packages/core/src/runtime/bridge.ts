import { swallow } from "./diagnostics";
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
  onSetRootDuration: (durationSeconds: number) => void;
  onSetColorGrading: (target: HfColorGradingTarget | string | null, grading: unknown) => void;
  onSetColorGradingCompare: (
    target: HfColorGradingTarget | string | null,
    compare: unknown,
  ) => void;
  onEnablePickMode: () => void;
  onDisablePickMode: () => void;
  getCanonicalFps: () => number;
};

let runtimeProtocolFps = 30;

export function setRuntimeProtocolFps(fps: number): void {
  runtimeProtocolFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
}

export function postRuntimeMessage(payload: RuntimeOutboundMessage): void {
  try {
    window.parent.postMessage({ ...payload, ...runtimeProtocolMetadata(runtimeProtocolFps) }, "*");
  } catch (err) {
    // Cross-frame posting can throw if the parent is gone or origin-isolated.
    swallow("bridge.postMessage", err);
  }
}

type BridgeControlData = Partial<RuntimeBridgeControlMessage & RuntimeProtocolV1>;
type ControlHandler = (data: BridgeControlData, deps: BridgeDeps) => void;

// Per-action dispatchers. Splitting the handler into a lookup table keeps the
// top-level message listener trivial (one map lookup), and each action's logic
// becomes individually testable / inheritable for fallow's CRAP analysis.
const CONTROL_HANDLERS: Record<string, ControlHandler> = {
  play: (_d, deps) => deps.onPlay(),
  pause: (_d, deps) => deps.onPause(),
  "stop-media": (_d, deps) => deps.onStopMedia(),
  seek: (data, deps) => deps.onSeek(resolveSeekTimeSeconds(data, deps), data.seekMode ?? "commit"),
  tick: (_d, deps) => deps.onTick(),
  "set-muted": (data, deps) => deps.onSetMuted(Boolean(data.muted)),
  "set-volume": (data, deps) =>
    deps.onSetVolume(Math.max(0, Math.min(1, Number(data.volume ?? 1)))),
  "set-media-output-muted": (data, deps) => deps.onSetMediaOutputMuted(Boolean(data.muted)),
  "set-native-media-sync-disabled": (data, deps) =>
    deps.onSetNativeMediaSyncDisabled(Boolean(data.disabled)),
  "set-web-audio-media-disabled": (data, deps) =>
    deps.onSetWebAudioMediaDisabled(Boolean(data.disabled)),
  "set-playback-rate": (data, deps) => deps.onSetPlaybackRate(Number(data.playbackRate ?? 1)),
  "set-root-duration": (data, deps) => deps.onSetRootDuration(Number(data.durationSeconds ?? 0)),
  "set-color-grading": (data, deps) =>
    deps.onSetColorGrading(data.target ?? null, data.grading ?? null),
  "set-color-grading-compare": (data, deps) =>
    deps.onSetColorGradingCompare(data.target ?? null, data.compare ?? null),
  "enable-pick-mode": (_d, deps) => deps.onEnablePickMode(),
  "disable-pick-mode": (_d, deps) => deps.onDisablePickMode(),
  "flash-elements": (data) => handleFlashElements(data),
};

function resolveSeekTimeSeconds(data: BridgeControlData, deps: BridgeDeps): number {
  const explicitSeconds = Number(data.timeSeconds);
  if (Number.isFinite(explicitSeconds)) return Math.max(0, explicitSeconds);
  const messageFps = runtimeProtocolFpsToNumber(data.fps);
  const fps = messageFps ?? deps.getCanonicalFps();
  return Math.max(0, Number(data.frame ?? 0)) / fps;
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

function handleFlashElements(data: BridgeControlData): void {
  // Briefly highlight elements — used by the chat-canvas bridge
  // to show what changed after an agent edit
  const selectors = (data as Record<string, unknown>).selectors as string[] | undefined;
  const duration = ((data as Record<string, unknown>).duration as number) || 800;
  if (selectors) {
    flashElements(selectors, duration);
  }
}

export function installRuntimeControlBridge(deps: BridgeDeps): (event: MessageEvent) => void {
  const handler = (event: MessageEvent) => {
    const data = event.data as BridgeControlData | null;
    if (!data || data.source !== "hf-parent" || data.type !== "control") return;
    if (rejectUnsupportedProtocol(data)) return;
    const action = data.action;
    if (typeof action !== "string") return;
    const fn = CONTROL_HANDLERS[action];
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

/**
 * Flash elements — briefly highlight them with a blue outline.
 * Used by the chat-canvas bridge to show what changed after an agent edit.
 */
function flashElements(selectors: string[], duration: number): void {
  if (!document.getElementById("__hf-flash-styles")) {
    const style = document.createElement("style");
    style.id = "__hf-flash-styles";
    style.textContent = `
      .__hf-flash {
        outline: 2px solid rgba(59, 130, 246, 0.6) !important;
        outline-offset: 2px !important;
        animation: __hf-flash-pulse ${duration}ms ease-out forwards !important;
      }
      @keyframes __hf-flash-pulse {
        0% { outline-color: rgba(59, 130, 246, 0.8); }
        100% { outline-color: transparent; }
      }
    `;
    document.head.appendChild(style);
  }

  for (const selector of selectors) {
    try {
      const els = document.querySelectorAll(selector);
      els.forEach((el) => {
        el.classList.add("__hf-flash");
        setTimeout(() => el.classList.remove("__hf-flash"), duration);
      });
    } catch (err) {
      // Invalid selector — skip
      swallow("bridge.flashElements.querySelector", err);
    }
  }
}
