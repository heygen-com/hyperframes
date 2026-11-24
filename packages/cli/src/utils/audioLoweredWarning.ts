/** The delivery step's flat cut to the whole mix, in words: it changes every quiet passage, so it is not a log line. */
export function audioLoweredWarning(
  audioLoweredDb: number | undefined,
): { code: string; message: string } | null {
  if (audioLoweredDb === undefined) return null;
  return {
    code: "audio_lowered",
    message:
      `Audio lowered ${audioLoweredDb.toFixed(1)} dB across the whole mix, because a peak passed the delivery ceiling. ` +
      "To keep the level, put a truepeak limiter with its ceiling at -3 on the mix; a limiter node can let fast peaks through.",
  };
}
