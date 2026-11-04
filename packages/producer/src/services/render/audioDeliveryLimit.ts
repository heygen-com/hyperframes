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

// The worklet's 4x detector can land up to 1.7 dB over its ceiling, hence 2 dB under the -1 dBTP limit.
const LIMIT_CEILING_DBTP = AAC_DELIVERY_TRUE_PEAK_DBFS - 2;
const LIMIT_CHAIN = {
  version: 1 as const,
  nodes: [{ type: "truepeak", id: "delivery", params: { ceiling: LIMIT_CEILING_DBTP } }],
};

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

  const limitedPath = join(dirname(sourcePath), "audio-source-limited.wav");
  try {
    await deps.applyChain(sourcePath, LIMIT_CHAIN, limitedPath, { trackId: "delivery", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    input.warn?.("[audio] true-peak limit failed, the whole-mix cut applies", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: true };
  }
  const encoded = await deps.encode(limitedPath, audioPath, input.targetDurationSeconds, {
    signal,
    timeout: timeoutMs,
  });
  if (!encoded.success) {
    return {
      success: false,
      error: `[audioDeliveryLimit] ${describeFfmpegFailure(encoded, timeoutMs)}`,
      failureReason: encoded.failureReason,
    };
  }
  deps.rename(limitedPath, sourcePath, { copyFallback: true });
  return { success: true };
}
