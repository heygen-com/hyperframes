import { missingPathOf } from "@hyperframes/core/missing-path";

const KINDS: ReadonlyArray<[RegExp, string]> = [
  [/(^|[\\/])hfcache-/, "extract_cache"],
  [/(^|[\\/])__hyperframes_video_frames([\\/]|$)/, "video_frames"],
  [/(^|[\\/])captured-frames([\\/]|$)/, "captured_frames"],
  [
    /(^|[\\/])(capture-attempt-\d+|retry-\d+-batch-\d+-worker-\d+|worker-\d+)([\\/]|$)/,
    "worker_frames",
  ],
  [/(^|[\\/])capture-calibration/, "calibration"],
  [/(^|[\\/])compiled([\\/]|$)/, "compiled"],
  [/(^|[\\/])(hf-render-|work-[0-9a-f]{8}-)/, "work_dir"],
];

/** Which kind of file a render found missing (a fixed name, never the path), or undefined when nothing was missing. */
export function missingPathKind(error: unknown): string | undefined {
  const path = missingPathOf(error);
  if (path === undefined) return undefined;
  return KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? "other";
}
