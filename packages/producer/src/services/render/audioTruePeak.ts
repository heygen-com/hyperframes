import {
  aacSegmentCount,
  describeFfmpegFailure,
  extractAudioMetadata,
  runFfmpeg,
} from "@hyperframes/engine";

/** Peaks in dBFS as ffmpeg's ebur128 prints them (one decimal). */
interface TruePeakScan {
  peak: number;
  /** From the per-100 ms frame log: the first block, and the loudest block after it. */
  firstBlock: number;
  laterBlocks: number;
}

const toDbfs = (token: string) =>
  token.toLowerCase() === "-inf" ? Number.NEGATIVE_INFINITY : Number(token);

function checkedDbfs(value: number): number {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
    throw new Error("[audioTruePeak] FFmpeg did not report AAC true peak");
  }
  return value;
}

async function scanTruePeak(
  audioPath: string,
  trim: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TruePeakScan> {
  let firstBlock: number | undefined;
  let laterBlocks = Number.NEGATIVE_INFINITY;
  let partialLine = "";
  const readLines = (chunk: string) => {
    const lines = (partialLine + chunk).split(/\r|\n/);
    partialLine = lines.pop() ?? "";
    for (const line of lines) {
      const ftpk = /FTPK:([^d]*)dBFS/.exec(line)?.[1];
      if (!ftpk) continue;
      // Runs in a stderr listener, so it must not throw; a bad token is checked after the run.
      const block = Math.max(...ftpk.trim().split(/\s+/).map(toDbfs));
      if (firstBlock === undefined) firstBlock = block;
      else laterBlocks = Math.max(laterBlocks, block);
    }
  };
  const result = await runFfmpeg(
    ["-i", audioPath, "-map", "0:a:0", "-vn", "-af", `${trim}ebur128=peak=true`, "-f", "null", "-"],
    { signal, timeout: timeoutMs, onStderr: readLines },
  );
  if (!result.success) {
    throw new Error(`[audioTruePeak] ${describeFfmpegFailure(result, timeoutMs)}`);
  }
  const summary = [...result.stderr.matchAll(/^\s*Peak:\s*([+-]?(?:[\d.]+|inf)) dBFS$/gim)];
  return {
    peak: checkedDbfs(toDbfs(summary.at(-1)?.[1] ?? "nan")),
    firstBlock: checkedDbfs(firstBlock ?? Number.NEGATIVE_INFINITY),
    laterBlocks: checkedDbfs(laterBlocks),
  };
}

/**
 * The true peak one `ebur128=peak=true` pass over the whole file reports, measured in parallel
 * segments when the file is 48 kHz with a known length: the same digit, not an estimate.
 */
export async function measureTruePeakDbfs(
  audioPath: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<number> {
  const { timeoutMs, signal } = options;
  const wholeFile = async () => (await scanTruePeak(audioPath, "", timeoutMs, signal)).peak;
  const { durationSeconds, sampleRate } = await extractAudioMetadata(audioPath, { signal });
  // ebur128 resamples any other rate to 48 kHz, which would move samples near each cut.
  // It logs one peak per 100 ms block; its 4x oversampler reads 15 samples back, 16 ahead.
  const block = 4800;
  const count =
    sampleRate === 48_000 && Number.isFinite(durationSeconds)
      ? aacSegmentCount(durationSeconds)
      : 1;
  if (count === 1) return wholeFile();

  const cut = (k: number) => k * Math.floor((durationSeconds * 10) / count) * block;
  const peers = new AbortController();
  const segmentSignal = signal ? AbortSignal.any([signal, peers.signal]) : peers.signal;
  const scans = await Promise.all(
    Array.from({ length: count }, (_, k) => {
      // A later segment starts one block early and drops that block: its oversampler starts
      // from mirrored history there, and the previous segment stops 16 samples short.
      const start = k === 0 ? 0 : cut(k) - block;
      const end = k === count - 1 ? "" : `:end_sample=${cut(k + 1)}`;
      return scanTruePeak(
        audioPath,
        `atrim=start_sample=${start}${end},`,
        timeoutMs,
        segmentSignal,
      );
    }),
  ).catch((error: unknown) => {
    peers.abort();
    throw error;
  });
  const last = scans[count - 1]!;
  const counted = Math.max(scans[0]!.peak, ...scans.slice(1).map((scan) => scan.laterBlocks));
  // The last segment's final partial block is logged only in its summary, which also holds its
  // dropped first block. When that first block alone could be the loudest, measure the whole file.
  if (last.peak > last.firstBlock || last.peak <= counted) return Math.max(counted, last.peak);
  return wholeFile();
}
