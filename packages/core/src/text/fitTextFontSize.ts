import { prepare, layout } from "@chenglou/pretext";

export type FitTextOptions = {
  /** Container width in px */
  maxWidth: number;
  /** Starting font size in px */
  baseFontSize: number;
  /** Floor font size in px */
  minFontSize: number;
  /** CSS font-weight */
  fontWeight: number;
  /** CSS font-family */
  fontFamily: string;
  /** Decrement step in px */
  step: number;
};

export type FitTextResult = {
  /** The computed font size that fits */
  fontSize: number;
  /** True if text fits at >= minFontSize */
  fits: boolean;
};

const DEFAULTS: FitTextOptions = {
  maxWidth: 1600,
  baseFontSize: 78,
  minFontSize: 42,
  fontWeight: 900,
  fontFamily: "Outfit",
  step: 2,
};

export function fitTextFontSize(text: string, options?: Partial<FitTextOptions>): FitTextResult {
  const opts = { ...DEFAULTS, ...options };
  const lineHeightRatio = 1.2;

  for (let size = opts.baseFontSize; size >= opts.minFontSize; size -= opts.step) {
    const font = `${opts.fontWeight} ${size}px ${opts.fontFamily}`;
    const prepared = prepare(text, font);
    const { lineCount } = layout(prepared, opts.maxWidth, size * lineHeightRatio);
    if (lineCount <= 1) {
      return { fontSize: size, fits: true };
    }
  }

  return { fontSize: opts.minFontSize, fits: false };
}
