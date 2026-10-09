import { findParakeet } from "./parakeet.js";
import { sherpaParakeetInstalled, sherpaUnsupportedReason } from "./sherpa.js";

export type ParakeetRunner = "sherpa" | "parakeet-mlx";

/** Transcribe's Parakeet runner here, sherpa-onnx first; `skipSherpa` once sherpa failed. */
export function parakeetRunner({
  unsupported = sherpaUnsupportedReason(),
  skipSherpa = false,
}: { unsupported?: string | null; skipSherpa?: boolean } = {}): ParakeetRunner | null {
  if (!skipSherpa && !unsupported && sherpaParakeetInstalled()) return "sherpa";
  return findParakeet() ? "parakeet-mlx" : null;
}
