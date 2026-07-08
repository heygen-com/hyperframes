import { computePsnrCheckpoints, computePsnrForExistingCheckpoints, probeVideo } from "./ffmpeg.ts";
import type {
  CheckpointPsnr,
  CheckpointVerdict,
  CompareVerdict,
  SecondBaselineVerdict,
} from "./types.ts";

export type { CompareVerdict } from "./types.ts";

export const HARD_FAIL_BELOW_DB = 30;
export const SECOND_BASELINE_BELOW_DB = 45;
export const AVERAGE_SCREEN_BELOW_DB = 50;
export const DEFAULT_CHECKPOINT_COUNT = 100;

export async function compareVideos(input: {
  itemName: string;
  baselineVideo: string;
  candidateVideo: string;
  checkpointCount?: number;
  fps?: number;
  secondBaselineVideo?: string;
  renderSecondBaseline?: () => Promise<string>;
}): Promise<CompareVerdict> {
  const checkpointCount = input.checkpointCount ?? DEFAULT_CHECKPOINT_COUNT;
  const rawCheckpoints = computePsnrCheckpoints({
    baselineVideo: input.baselineVideo,
    candidateVideo: input.candidateVideo,
    checkpointCount,
    fps: input.fps,
  });
  const fps = input.fps ?? probeVideo(input.candidateVideo).fps;
  const lowBand = rawCheckpoints.filter(
    (checkpoint) =>
      checkpoint.psnr >= HARD_FAIL_BELOW_DB && checkpoint.psnr < SECOND_BASELINE_BELOW_DB,
  );

  const secondBaseline = await resolveSecondBaseline({
    lowBand,
    baselineVideo: input.baselineVideo,
    secondBaselineVideo: input.secondBaselineVideo,
    renderSecondBaseline: input.renderSecondBaseline,
    fps,
  });

  const secondBaselineByIndex = new Map<number, number>();
  for (const checkpoint of secondBaseline.checkpoints) {
    secondBaselineByIndex.set(checkpoint.index, checkpoint.psnr);
  }

  const checkpoints = rawCheckpoints.map((checkpoint) =>
    checkpointVerdict(checkpoint, secondBaselineByIndex, secondBaseline.result),
  );
  const damagedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.damaged);
  const average = computeAveragePsnr(rawCheckpoints);

  return {
    item_name: input.itemName,
    baseline_video: input.baselineVideo,
    candidate_video: input.candidateVideo,
    verdict: damagedCheckpoints.length > 0 ? "damaged" : "pass",
    screening_flag: average < AVERAGE_SCREEN_BELOW_DB,
    average_psnr: average,
    thresholds: {
      hard_fail_below_db: HARD_FAIL_BELOW_DB,
      second_baseline_below_db: SECOND_BASELINE_BELOW_DB,
      average_screen_below_db: AVERAGE_SCREEN_BELOW_DB,
    },
    checkpoints,
    damaged_checkpoints: damagedCheckpoints,
    worst_checkpoints: [...checkpoints]
      .sort((a, b) => psnrSortValue(a.psnr) - psnrSortValue(b.psnr))
      .slice(0, 5),
    second_baseline: secondBaseline.result,
  };
}

function checkpointVerdict(
  checkpoint: CheckpointPsnr,
  secondBaselineByIndex: Map<number, number>,
  secondBaseline: SecondBaselineVerdict,
): CheckpointVerdict {
  if (checkpoint.psnr < HARD_FAIL_BELOW_DB) {
    return {
      ...checkpoint,
      damaged: true,
      waived_by_second_baseline: false,
      second_baseline_psnr: null,
      reason: "hard-fail",
    };
  }
  if (checkpoint.psnr >= SECOND_BASELINE_BELOW_DB) {
    return {
      ...checkpoint,
      damaged: false,
      waived_by_second_baseline: false,
      second_baseline_psnr: null,
      reason: "pass",
    };
  }

  const secondPsnr = secondBaselineByIndex.get(checkpoint.index) ?? null;
  if (!secondBaseline.ran || secondPsnr === null) {
    return {
      ...checkpoint,
      damaged: true,
      waived_by_second_baseline: false,
      second_baseline_psnr: secondPsnr,
      reason: "second-baseline-missing",
    };
  }
  if (secondPsnr < SECOND_BASELINE_BELOW_DB) {
    return {
      ...checkpoint,
      damaged: false,
      waived_by_second_baseline: true,
      second_baseline_psnr: secondPsnr,
      reason: "second-baseline-waived",
    };
  }
  return {
    ...checkpoint,
    damaged: true,
    waived_by_second_baseline: false,
    second_baseline_psnr: secondPsnr,
    reason: "low-band",
  };
}

async function resolveSecondBaseline(input: {
  lowBand: CheckpointPsnr[];
  baselineVideo: string;
  fps: number;
  secondBaselineVideo?: string;
  renderSecondBaseline?: () => Promise<string>;
}): Promise<{ result: SecondBaselineVerdict; checkpoints: CheckpointPsnr[] }> {
  if (input.lowBand.length === 0) {
    return {
      result: {
        ran: false,
        triggered_checkpoint_indexes: [],
        waived_checkpoint_indexes: [],
        damaged_checkpoint_indexes: [],
        video_path: null,
      },
      checkpoints: [],
    };
  }

  try {
    const videoPath =
      input.secondBaselineVideo ??
      (input.renderSecondBaseline ? await input.renderSecondBaseline() : null);
    if (videoPath === null) {
      return {
        result: {
          ran: false,
          triggered_checkpoint_indexes: input.lowBand.map((checkpoint) => checkpoint.index),
          waived_checkpoint_indexes: [],
          damaged_checkpoint_indexes: input.lowBand.map((checkpoint) => checkpoint.index),
          video_path: null,
          error_message: "second baseline render was not configured",
        },
        checkpoints: [],
      };
    }

    const checkpoints = computePsnrForExistingCheckpoints({
      candidateVideo: videoPath,
      baselineVideo: input.baselineVideo,
      checkpoints: input.lowBand,
      fps: input.fps,
    });
    const waived = checkpoints
      .filter((checkpoint) => checkpoint.psnr < SECOND_BASELINE_BELOW_DB)
      .map((checkpoint) => checkpoint.index);
    const damaged = checkpoints
      .filter((checkpoint) => checkpoint.psnr >= SECOND_BASELINE_BELOW_DB)
      .map((checkpoint) => checkpoint.index);
    return {
      result: {
        ran: true,
        triggered_checkpoint_indexes: input.lowBand.map((checkpoint) => checkpoint.index),
        waived_checkpoint_indexes: waived,
        damaged_checkpoint_indexes: damaged,
        video_path: videoPath,
      },
      checkpoints,
    };
  } catch (error) {
    return {
      result: {
        ran: true,
        triggered_checkpoint_indexes: input.lowBand.map((checkpoint) => checkpoint.index),
        waived_checkpoint_indexes: [],
        damaged_checkpoint_indexes: input.lowBand.map((checkpoint) => checkpoint.index),
        video_path: input.secondBaselineVideo ?? null,
        error_message: error instanceof Error ? error.message : String(error),
      },
      checkpoints: [],
    };
  }
}

function computeAveragePsnr(checkpoints: CheckpointPsnr[]): number {
  const finite = checkpoints
    .map((checkpoint) => checkpoint.psnr)
    .filter((psnr) => Number.isFinite(psnr));
  if (finite.length === 0) return Number.POSITIVE_INFINITY;
  return finite.reduce((sum, psnr) => sum + psnr, 0) / finite.length;
}

function psnrSortValue(psnr: number): number {
  return Number.isFinite(psnr) ? psnr : Number.MAX_SAFE_INTEGER;
}
