import { findParakeet } from "./parakeet.js";
import { sherpaParakeetInstalled, sherpaUnsupportedReason } from "./sherpa.js";

export type ParakeetRunner = "sherpa" | "parakeet-mlx";

/** The runner transcribe uses for Parakeet here, sherpa-onnx first; null when neither can run.
 *  `skipSherpa`: sherpa already failed this run. */
export function parakeetRunner({
  unsupported = sherpaUnsupportedReason(),
  skipSherpa = false,
}: { unsupported?: string | null; skipSherpa?: boolean } = {}): ParakeetRunner | null {
  if (!skipSherpa && !unsupported && sherpaParakeetInstalled()) return "sherpa";
  return findParakeet() ? "parakeet-mlx" : null;
}
