import type { RuntimeBridgeControlMessage, RuntimeOutboundMessage } from "./types";

type BridgeDeps = {
  onPlay: () => void;
  onPause: () => void;
  onSeek: (frame: number, seekMode: "drag" | "commit") => void;
  onSetMuted: (muted: boolean) => void;
  onSetPlaybackRate: (rate: number) => void;
  onEnablePickMode: () => void;
  onDisablePickMode: () => void;
};

export function postRuntimeMessage(payload: RuntimeOutboundMessage): void {
  try {
    window.parent.postMessage(payload, "*");
  } catch {
    // Ignore cross-frame posting failures.
  }
}

export function installRuntimeControlBridge(deps: BridgeDeps): (event: MessageEvent) => void {
  const handler = (event: MessageEvent) => {
    const data = event.data as Partial<RuntimeBridgeControlMessage> | null;
    if (!data || data.source !== "hf-parent" || data.type !== "control") return;
    const action = data.action;
    if (action === "play") {
      deps.onPlay();
      return;
    }
    if (action === "pause") {
      deps.onPause();
      return;
    }
    if (action === "seek") {
      deps.onSeek(Number(data.frame ?? 0), data.seekMode ?? "commit");
      return;
    }
    if (action === "set-muted") {
      deps.onSetMuted(Boolean(data.muted));
      return;
    }
    if (action === "set-playback-rate") {
      deps.onSetPlaybackRate(Number(data.playbackRate ?? 1));
      return;
    }
    if (action === "enable-pick-mode") {
      deps.onEnablePickMode();
      return;
    }
    if (action === "disable-pick-mode") {
      deps.onDisablePickMode();
      return;
    }
    if (action === "flash-elements") {
      // Briefly highlight elements — used by the chat-canvas bridge
      // to show what changed after an agent edit
      const selectors = (data as Record<string, unknown>).selectors as string[] | undefined;
      const duration = ((data as Record<string, unknown>).duration as number) || 800;
      if (selectors) {
        flashElements(selectors, duration);
      }
    }
  };
  window.addEventListener("message", handler);
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
    } catch {
      // Invalid selector — skip
    }
  }
}
