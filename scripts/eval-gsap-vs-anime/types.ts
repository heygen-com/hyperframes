export type RegistryItemKind = "block" | "component" | "example";

export type Dimensions = {
  width: number;
  height: number;
};

export type RegistryItem = {
  key: string;
  name: string;
  kind: RegistryItemKind;
  sourceDir: string;
  itemDirRelative: string;
  entryFile: string;
  dimensions: Dimensions;
  duration: number;
  fps: number;
  notes: string[];
};

export type BaselineStatus = "pending" | "success" | "failed";

export type BaselineManifestEntry = {
  item_key: string;
  item_name: string;
  kind: RegistryItemKind;
  source_dir: string;
  entry_file: string;
  baseline_video_path: string;
  fork_sha: string;
  rendered_at: string | null;
  fps: number;
  duration: number;
  dimensions: Dimensions;
  status: BaselineStatus;
  render_duration_ms: number | null;
  error_message?: string;
  notes?: string[];
};

export type BaselineManifest = {
  version: 1;
  fork_sha: string;
  baseline_dir: string;
  generated_at: string;
  updated_at: string;
  entries: BaselineManifestEntry[];
};

export type CheckpointPsnr = {
  index: number;
  time_seconds: number;
  frame_index: number;
  psnr: number;
};

export type CheckpointVerdict = CheckpointPsnr & {
  damaged: boolean;
  waived_by_second_baseline: boolean;
  second_baseline_psnr: number | null;
  reason: "pass" | "hard-fail" | "second-baseline-missing" | "second-baseline-waived" | "low-band";
};

export type SecondBaselineVerdict = {
  ran: boolean;
  triggered_checkpoint_indexes: number[];
  waived_checkpoint_indexes: number[];
  damaged_checkpoint_indexes: number[];
  video_path: string | null;
  error_message?: string;
};

export type CompareVerdict = {
  item_name: string;
  baseline_video: string;
  candidate_video: string;
  verdict: "pass" | "damaged";
  screening_flag: boolean;
  average_psnr: number;
  thresholds: {
    hard_fail_below_db: number;
    second_baseline_below_db: number;
    average_screen_below_db: number;
  };
  checkpoints: CheckpointVerdict[];
  damaged_checkpoints: CheckpointVerdict[];
  worst_checkpoints: CheckpointVerdict[];
  second_baseline: SecondBaselineVerdict;
};
