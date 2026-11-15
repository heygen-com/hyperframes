import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyAudioFxChain,
  describeFfmpegFailure,
  encodeAac,
  renameWithRetry,
} from "@hyperframes/engine";
import { AAC_DELIVERY_TRUE_PEAK_DBFS } from "./audioPadTrim.js";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

// Each pass lowers the ceiling by what the last encode measured over it; past -3 dBTP the whole-mix cut takes over.
const LIMIT_PASSES = 3;
const LOWEST_CEILING_DBTP = AAC_DELIVERY_TRUE_PEAK_DBFS - 2;
const PASS_HEADROOM_DB = 0.05;
const limitChain = (ceiling: number) => ({
  version: 1 as const,
  nodes: [{ type: "truepeak", id: "delivery", params: { ceiling } }],
});

interface DeliveryLimitDeps {
  measure: typeof measureTruePeakDbfs;
  applyChain: typeof applyAudioFxChain;
  encode: typeof encodeAac;
  rename: typeof renameWithRetry;
  sourceExists: (path: string) => boolean;
}

/** Holds a mix over the delivery ceiling to it peak by peak, so quiet passages keep their level. The whole-mix cut
 * in `constrainAacTruePeak` stays behind this, for what still gets over or a mix this could not limit. */
export async function limitDeliveryPeaks(
  input: {
    audioPath: string;
    sourcePath: string;
    targetDurationSeconds: number;
    signal?: AbortSignal;
    timeoutMs: number;
    warn?: (message: string, details: { error: string }) => void;
  },
  deps: DeliveryLimitDeps = {
    measure: measureTruePeakDbfs,
    applyChain: applyAudioFxChain,
    encode: encodeAac,
    rename: renameWithRetry,
    sourceExists: existsSync,
  },
): Promise<{ success: boolean; error?: string; failureReason?: "external_interruption" }> {
  const { audioPath, sourcePath, signal, timeoutMs } = input;
  if (!deps.sourceExists(sourcePath)) return { success: true };
  const peak = await deps.measure(audioPath, { timeoutMs, signal });
  if (peak <= AAC_DELIVERY_TRUE_PEAK_DBFS) return { success: true };

  const alternating = ["a", "b"].map((k) =>
    join(dirname(sourcePath), `audio-source-limited-${k}.wav`),
  );
  let encodedFrom: string | undefined;
  let ceiling = AAC_DELIVERY_TRUE_PEAK_DBFS;
  for (let pass = 0; pass < LIMIT_PASSES; pass++) {
    const limitedPath = alternating[pass % 2]!;
    const result = await limitPass(input, deps, ceiling, limitedPath);
    if ("encodeFailure" in result) return result.encodeFailure;
    if ("limitFailed" in result) break;
    encodedFrom = limitedPath;
    if (result.peak <= AAC_DELIVERY_TRUE_PEAK_DBFS || ceiling <= LOWEST_CEILING_DBTP) break;
    ceiling = Math.max(
      ceiling - (result.peak - AAC_DELIVERY_TRUE_PEAK_DBFS) - PASS_HEADROOM_DB,
      LOWEST_CEILING_DBTP,
    );
  }
  if (encodedFrom) deps.rename(encodedFrom, sourcePath, { copyFallback: true });
  return { success: true };
}

type DeliveryLimitResult = Awaited<ReturnType<typeof limitDeliveryPeaks>>;

/** One pass: the original mix limited at `ceiling` into `limitedPath`, encoded to the delivery file, and measured. */
async function limitPass(
  input: Parameters<typeof limitDeliveryPeaks>[0],
  deps: DeliveryLimitDeps,
  ceiling: number,
  limitedPath: string,
): Promise<{ peak: number } | { limitFailed: true } | { encodeFailure: DeliveryLimitResult }> {
  const { audioPath, sourcePath, signal, timeoutMs } = input;
  try {
    await deps.applyChain(sourcePath, limitChain(ceiling), limitedPath, {
      trackId: "delivery",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    input.warn?.("[audio] true-peak limit failed, the whole-mix cut applies", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { limitFailed: true };
  }
  const encoded = await deps.encode(limitedPath, audioPath, input.targetDurationSeconds, {
    signal,
    timeout: timeoutMs,
  });
  if (!encoded.success) {
    return {
      encodeFailure: {
        success: false,
        error: `[audioDeliveryLimit] ${describeFfmpegFailure(encoded, timeoutMs)}`,
        failureReason: encoded.failureReason,
      },
    };
  }
  return { peak: await deps.measure(audioPath, { timeoutMs, signal }) };
}
