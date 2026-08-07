/**
 * The on-device embedding model behind local semantic search.
 *
 * Downloading roughly 33 MB to someone's disk is worth asking about. This is
 * not a privacy question, because nothing leaves the machine, so the prompt
 * says what it actually costs: disk and bandwidth. Borrowing privacy language
 * here would misdescribe it.
 *
 * The CLI already downloads a much larger model for background removal without
 * asking, and that is defensible there: running that command is itself a
 * request for a model. Searching a catalog is not, so a download arriving
 * mid-search would be a surprise. That difference is why this asks and that
 * does not.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { downloadFile } from "../utils/download.js";
import { readConfig, writeConfig } from "../telemetry/config.js";

/**
 * bge-small-en-v1.5: 62.17 MTEB average against 62.3 for the hosted model this
 * substitutes for, at 384 dimensions instead of 1536. Chosen for being close to
 * parity while small enough to ship, not for being a weaker tier.
 */
export const LOCAL_MODEL_ID = "bge-small-en-v1.5";
export const LOCAL_MODEL_DIMENSIONS = 384;
/** Measured: 32 MB quantized model plus a 0.7 MB tokenizer. */
export const LOCAL_MODEL_SIZE_MB = 33;

/** bge retrieval expects short queries to carry this prefix; passages do not. */
export const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

const MODELS_DIR = join(homedir(), ".hyperframes", "models");

/**
 * Where the two halves come from.
 *
 * Pinned to a revision rather than to `main`: a model that silently changes
 * under a cached vector set would return confident nonsense, because the
 * catalog vectors were produced by a specific set of weights.
 */
const MODEL_REPO = "Xenova/bge-small-en-v1.5";
const MODEL_REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";

/**
 * The quantized export, 32 MB, not the 126 MB full-precision one.
 *
 * The size this feature quotes has always described the quantized build. The
 * catalog vectors must be produced by this same file: embedding the catalog
 * with one precision and the query with another degrades ranking silently,
 * which is the failure mode this whole feature keeps having to defend against.
 */
const MODEL_FILES: ReadonlyArray<{ url: string; dest: () => string }> = [
  {
    url: `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/onnx/model_quantized.onnx`,
    dest: () => localModelPath(),
  },
  {
    url: `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/tokenizer.json`,
    dest: () => localTokenizerPath(),
  },
];

export type LocalModelDecision = boolean | undefined;

export function localModelConsent(): LocalModelDecision {
  return readConfig().localEmbeddingEnabled;
}

export function recordLocalModelConsent(enabled: boolean): void {
  writeConfig({ ...readConfig(), localEmbeddingEnabled: enabled });
}

export function localModelPath(): string {
  return join(MODELS_DIR, `${LOCAL_MODEL_ID}.onnx`);
}

export function localTokenizerPath(): string {
  return join(MODELS_DIR, `${LOCAL_MODEL_ID}.tokenizer.json`);
}

/** Both halves must be present. A model without its tokenizer cannot embed anything. */
export function isLocalModelReady(): boolean {
  return existsSync(localModelPath()) && existsSync(localTokenizerPath());
}

export type LocalModelStatus =
  | { status: "ready" }
  | { status: "declined" }
  | { status: "not-asked" }
  | { status: "unavailable"; reason: string };

/**
 * Resolve whether local semantic search can run right now.
 *
 * Deliberately does not prompt. The caller owns that, because only the caller
 * knows whether word matching already answered well enough to make the offer
 * pointless. Consent has one owner, which is the lesson the smart-search flag
 * taught when it was checked in two places and the override became a no-op.
 */
export function localModelStatus(): LocalModelStatus {
  const consent = localModelConsent();
  if (consent === false) return { status: "declined" };
  if (isLocalModelReady()) return { status: "ready" };
  if (consent === undefined) return { status: "not-asked" };
  return { status: "unavailable", reason: "model not downloaded yet" };
}

export function modelsDirectory(): string {
  mkdirSync(MODELS_DIR, { recursive: true });
  return MODELS_DIR;
}

/**
 * Put the model on disk, once.
 *
 * Returns false rather than throwing: a failed download costs the offline tier,
 * never the command, and the caller says so. Both halves are fetched before
 * either is reported ready, because a model without its tokenizer embeds
 * nothing and would fail later at a less obvious place.
 */
export async function ensureLocalModel(): Promise<boolean> {
  if (isLocalModelReady()) return true;
  try {
    mkdirSync(MODELS_DIR, { recursive: true });
    for (const file of MODEL_FILES) {
      if (existsSync(file.dest())) continue;
      await downloadFile(file.url, file.dest());
    }
    return isLocalModelReady();
  } catch {
    return false;
  }
}

/**
 * What to print when nobody can be asked.
 *
 * An agent or CI run has no one to prompt, and it must not decide a download
 * onto someone's disk by itself. So it is told what to ask and which flag
 * records the answer. Passing the flag is the human's yes, not the agent's.
 */
export function nonInteractiveConsentMessage(): string {
  return (
    `On-device search needs a one-time ${LOCAL_MODEL_SIZE_MB} MB download that stays on this machine. ` +
    "Nothing is sent anywhere. Ask the person you are working for, and pass --on-device once they agree."
  );
}

/** What the prompt should say. Costs, not privacy: nothing is sent anywhere. */
export function downloadOfferMessage(matchCount: number): string {
  const found =
    matchCount === 0
      ? "No matches from word search."
      : `Only ${matchCount} match${matchCount === 1 ? "" : "es"} from word search.`;
  return `${found} Download a ${LOCAL_MODEL_SIZE_MB} MB search model for better offline results? It stays on your machine and nothing is sent.`;
}
