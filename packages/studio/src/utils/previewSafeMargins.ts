export interface SafeBox {
  kind: "action" | "title" | "vertical";
  label: string;
  /** Inset from each frame edge as a fraction of the frame (0 to 1). */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SafeMargins {
  framing: "wide" | "vertical";
  boxes: SafeBox[];
  /** Fraction of frame height from the top where the caption band ends. */
  captionBottom: number;
  /** The box the caption band spans (the innermost one). */
  captionBox: SafeBox;
}

// EBU R 95 and SMPTE ST 2046-1: action-safe 93%, title-safe 90% (https://tech.ebu.ch/publications/r095)
export const WIDE_ACTION_SAFE_PERCENT = 93;
export const WIDE_TITLE_SAFE_PERCENT = 90;

// Union of the TikTok, Reels and Shorts UI overlays on a 1080x1920 frame; left mirrors right (no UI there).
const VERTICAL_REFERENCE_SIZE = { width: 1080, height: 1920 };
export const VERTICAL_INSETS_PX = { top: 250, bottom: 484, left: 140, right: 140 };

/** Height of the caption band above its lower edge, as a fraction of frame height. Studio's own choice. */
export const CAPTION_BAND_HEIGHT = 0.08;

function insetBox(kind: SafeBox["kind"], label: string, percent: number): SafeBox {
  const inset = (100 - percent) / 2 / 100;
  return { kind, label, left: inset, top: inset, right: inset, bottom: inset };
}

export function resolveSafeMargins(width: number, height: number): SafeMargins {
  if (height <= width) {
    const title = insetBox(
      "title",
      `Title-safe ${WIDE_TITLE_SAFE_PERCENT}%`,
      WIDE_TITLE_SAFE_PERCENT,
    );
    return {
      framing: "wide",
      boxes: [
        insetBox("action", `Action-safe ${WIDE_ACTION_SAFE_PERCENT}%`, WIDE_ACTION_SAFE_PERCENT),
        title,
      ],
      captionBottom: 1 - title.bottom,
      captionBox: title,
    };
  }
  const { width: refW, height: refH } = VERTICAL_REFERENCE_SIZE;
  const box: SafeBox = {
    kind: "vertical",
    label: "Safe zone",
    left: VERTICAL_INSETS_PX.left / refW,
    top: VERTICAL_INSETS_PX.top / refH,
    right: VERTICAL_INSETS_PX.right / refW,
    bottom: VERTICAL_INSETS_PX.bottom / refH,
  };
  return { framing: "vertical", boxes: [box], captionBottom: 1 - box.bottom, captionBox: box };
}
