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
/**
 * Per-deck channel name. The presenter and its audience window load the same URL
 * (path), so keying on pathname keeps them paired while isolating other decks
 * presenting on the same origin (which would otherwise cross-talk on a fixed name).
 */
export function slideshowChannelName(): string {
  const path = typeof location !== "undefined" ? location.pathname : "";
  return `hf-slideshow:${path}`;
}

export class SlideshowChannel {
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly mode: "presenter" | "audience",
    private readonly onGoto: (msg: GotoMessage) => void,
  ) {
    try {
      this.channel = new BroadcastChannel(slideshowChannelName());
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
 * Builds the presenter-mode bottom panel: speaker notes + up-next + counter +
 * elapsed. The live slide is shown ABOVE this panel (the component confines the
 * player to the top region). Returns the panel HTML only — the component appends
 * the nav controls separately.
 */
export function buildPresenterLayout(opts: {
  notes: string;
  notesStorageKey: string | null;
  nextText: string;
  counterText: string;
  elapsedText: string;
  hotspots: { id: string; label: string; target: string }[];
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");
  const notes = esc(opts.notes);
  // Branch entries for the current slide — the presenter clicks these to enter a
  // branch (the audience follows). The component wires [data-hotspot-id] to
  // enterBranch(); positioned pills don't align with the letterboxed slide, so
  // they live in the console as a list.
  const branches = opts.hotspots.length
    ? `<div style="display:flex;flex-direction:column;gap:6px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.55;">Branches</div>
    ${opts.hotspots
      .map(
        (h) =>
          `<button data-hotspot-id="${escAttr(h.id)}" data-hotspot-target="${escAttr(h.target)}" type="button" style="text-align:left;background:rgba(244,183,64,0.14);color:#f4b740;border:1px solid rgba(244,183,64,0.4);border-radius:8px;padding:8px 12px;font-size:15px;cursor:pointer;pointer-events:auto;font-family:inherit;">&#8627; ${esc(h.label)}</button>`,
      )
      .join("")}
  </div>`
    : "";
  return `
<div data-hf-presenter style="position:absolute;left:0;right:0;bottom:0;height:32%;display:flex;background:#11151f;color:#fff;border-top:2px solid rgba(255,255,255,0.12);box-sizing:border-box;font-family:sans-serif;pointer-events:auto;">
  <textarea data-hf-presenter-notes data-hf-presenter-notes-key="${escAttr(opts.notesStorageKey ?? "")}" aria-label="Speaker notes" placeholder="No notes for this slide" spellcheck="true" style="flex:1;min-width:0;padding:24px 36px;overflow:auto;font:inherit;font-size:21px;line-height:1.55;color:#fff;background:transparent;border:0;outline:none;resize:none;white-space:pre-wrap;pointer-events:auto;">${notes}</textarea>
  <div style="width:380px;flex-shrink:0;border-left:1px solid rgba(255,255,255,0.12);padding:24px 28px;display:flex;flex-direction:column;gap:10px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.55;">Up next</div>
    <div data-hf-presenter-next style="font-size:17px;opacity:.9;line-height:1.4;">${esc(opts.nextText)}</div>
    ${branches}
    <div style="display:flex;gap:34px;margin-top:auto;">
      <div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.5;margin-bottom:3px;">Slide</div><div data-hf-presenter-counter style="font-size:23px;font-variant-numeric:tabular-nums;">${esc(opts.counterText)}</div></div>
      <div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;opacity:.5;margin-bottom:3px;">Elapsed</div><div data-hf-presenter-elapsed style="font-size:23px;font-variant-numeric:tabular-nums;">${esc(opts.elapsedText)}</div></div>
    </div>
  </div>
</div>`.trim();
}

/** Format elapsed seconds as mm:ss */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
