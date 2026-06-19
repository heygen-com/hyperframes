export interface PresenterPosition {
  sequenceId: string;
  slideIndex: number;
  fragmentIndex: number;
}

interface GotoMessage {
  type: "goto";
  sequenceId: string;
  slideIndex: number;
  fragmentIndex: number;
}

function isGotoMessage(data: unknown): data is GotoMessage {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d["type"] === "goto" &&
    typeof d["sequenceId"] === "string" &&
    typeof d["slideIndex"] === "number" &&
    typeof d["fragmentIndex"] === "number"
  );
}

/**
 * Manages the BroadcastChannel connection for a single slideshow element.
 * Presenter (default) mode: posts position updates to the channel.
 * Audience mode: listens for goto messages and calls the provided handler.
 */
export class SlideshowChannel {
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly mode: "presenter" | "audience",
    private readonly onGoto: (msg: GotoMessage) => void,
  ) {
    try {
      this.channel = new BroadcastChannel("hf-slideshow");
    } catch {
      // BroadcastChannel unavailable (e.g. unsupported env); degrade silently.
      return;
    }

    if (mode === "audience") {
      this.channel.onmessage = (e: MessageEvent) => {
        if (isGotoMessage(e.data)) {
          this.onGoto(e.data);
        }
      };
    }
  }

  postPosition(pos: PresenterPosition): void {
    if (this.mode !== "presenter" || !this.channel) return;
    const msg: GotoMessage = { type: "goto", ...pos };
    this.channel.postMessage(msg);
  }

  destroy(): void {
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
  }
}

/**
 * Builds the presenter-mode inner HTML showing current slide area,
 * next-slide preview, notes, counter, and elapsed timer.
 */
export function buildPresenterLayout(opts: {
  currentSlideHtml: string;
  nextSlideHtml: string;
  notes: string;
  counterText: string;
  elapsedText: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `
<div data-hf-presenter style="display:grid;grid-template-columns:2fr 1fr;grid-template-rows:auto 1fr;gap:12px;padding:12px;height:100%;box-sizing:border-box;background:#1a1a1a;color:#fff;font-family:sans-serif;">
  <div data-hf-presenter-current style="grid-column:1;grid-row:1/3;border:2px solid #444;border-radius:6px;overflow:hidden;position:relative;">
    ${opts.currentSlideHtml}
  </div>
  <div style="grid-column:2;grid-row:1;display:flex;flex-direction:column;gap:8px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.6;">Next</div>
    <div data-hf-presenter-next style="border:1px solid #333;border-radius:4px;overflow:hidden;opacity:.7;">
      ${opts.nextSlideHtml}
    </div>
    <div data-hf-presenter-counter style="font-size:13px;opacity:.8;">${esc(opts.counterText)}</div>
    <div data-hf-presenter-elapsed style="font-size:13px;font-variant-numeric:tabular-nums;">${esc(opts.elapsedText)}</div>
  </div>
  <div data-hf-presenter-notes style="grid-column:2;grid-row:2;overflow-y:auto;font-size:13px;line-height:1.5;opacity:.9;border-top:1px solid #333;padding-top:8px;">${esc(opts.notes)}</div>
</div>`.trim();
}

/** Format elapsed seconds as mm:ss */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
