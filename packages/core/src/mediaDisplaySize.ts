/** A video file's facts as ffprobe reports them, as far as its shown size needs. */
export interface MediaDisplayFacts {
  width: number;
  height: number;
  sampleAspectRatio?: number;
  rotation?: number;
}

/** The size a video shows at: its pixels stretched by their aspect ratio, then turned. */
export function displaySize(facts: MediaDisplayFacts): { width: number; height: number } {
  const width = Math.round(facts.width * (facts.sampleAspectRatio ?? 1));
  return Math.abs(facts.rotation ?? 0) % 180 === 90
    ? { width: facts.height, height: width }
    : { width, height: facts.height };
}

export function parseSampleAspectRatio(value: string | undefined): number | undefined {
  const [num, den] = (value ?? "").split(":").map(Number);
  if (!num || !den || !Number.isFinite(num) || !Number.isFinite(den)) return undefined;
  const ratio = num / den;
  return Math.abs(ratio - 1) < 1e-3 ? undefined : ratio;
}

/** The turn ffprobe reports for a stream, from its display matrix or its older `rotate` tag. */
export function streamRotation(stream: {
  side_data_list?: { rotation?: number | string }[];
  tags?: Record<string, string | undefined>;
}): number | undefined {
  const turn = Number(
    stream.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ??
      stream.tags?.rotate ??
      0,
  );
  return Number.isFinite(turn) && turn % 360 !== 0 ? turn : undefined;
}
