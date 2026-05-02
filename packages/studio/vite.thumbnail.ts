interface ThumbnailPreviewPage {
  evaluate<TArg, TResult>(
    fn: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg,
  ): Promise<TResult>;
}

type SeekResult = "player" | "timelines" | "none";

export async function seekThumbnailPreview(
  page: ThumbnailPreviewPage,
  seekTime: number,
): Promise<SeekResult> {
  return page.evaluate((t: number): SeekResult => {
    const w = window as Window & {
      __player?: { seek?: (time: number) => void };
      __timelines?: Record<string, { pause?: (time?: number) => void }>;
      gsap?: { ticker?: { tick?: () => void } };
    };

    if (typeof w.__player?.seek === "function") {
      w.__player.seek(t);
      return "player";
    }

    if (w.__timelines) {
      for (const tl of Object.values(w.__timelines)) {
        tl?.pause?.(t);
      }
      w.gsap?.ticker?.tick?.();
      return "timelines";
    }

    return "none";
  }, seekTime);
}
