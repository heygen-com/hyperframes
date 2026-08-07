/**
 * On-device embeddings for local semantic search.
 *
 * Runs bge-small-en-v1.5 through the ONNX runtime the CLI already depends on,
 * with the WordPiece tokenizer in `wordpiece.ts`. Nothing is sent anywhere and
 * nothing costs money once the model is cached.
 *
 * Two details are specific to bge and easy to miss. Pooling takes the CLS token
 * rather than a mean over the sequence, and short queries carry an instruction
 * prefix that passages do not. Getting either wrong degrades retrieval quietly
 * rather than failing, so both are asserted in tests.
 */

import { readFileSync } from "node:fs";

import {
  LOCAL_MODEL_DIMENSIONS,
  QUERY_INSTRUCTION,
  localModelPath,
  localTokenizerPath,
} from "./localModel.js";
import { configFromTokenizerJson, encode } from "./wordpiece.js";

export interface LocalEmbedder {
  embed(texts: string[], options?: { isQuery?: boolean }): Promise<number[][]>;
}

/** Long inputs are truncated rather than rejected; the model has a 512 token limit. */
const MAX_TOKENS = 512;

/**
 * Is the native ONNX runtime reachable in this install?
 *
 * It cannot be bundled: a single-file build leaves `onnxruntime-node` as an
 * unresolved import, so on-device search is unavailable there no matter what
 * else is on disk. Checking costs one dynamic import and saves a pointless
 * 32 MB download.
 */
export async function localRuntimeAvailable(): Promise<boolean> {
  try {
    await import("onnxruntime-node");
    return true;
  } catch {
    return false;
  }
}

export async function loadLocalEmbedder(): Promise<LocalEmbedder> {
  // Imported lazily so the CLI does not pay for the ONNX runtime on every run.
  const ort = await import("onnxruntime-node");
  const config = configFromTokenizerJson(readFileSync(localTokenizerPath(), "utf-8"));
  const session = await ort.InferenceSession.create(localModelPath());

  return {
    async embed(texts, options) {
      if (texts.length === 0) return [];
      const prefix = options?.isQuery ? QUERY_INSTRUCTION : "";
      const encodings = texts.map((text) => truncate(encode(prefix + text, config)));
      const width = Math.max(...encodings.map((e) => e.ids.length));

      const batch = encodings.length;
      const ids = new BigInt64Array(batch * width);
      const mask = new BigInt64Array(batch * width);
      const types = new BigInt64Array(batch * width);
      encodings.forEach((encoding, row) => {
        encoding.ids.forEach((id, column) => {
          const at = row * width + column;
          ids[at] = BigInt(id);
          mask[at] = 1n;
          types[at] = 0n;
        });
        // Remaining positions stay zero: padded ids with a zero attention mask,
        // which the model must not attend to.
      });

      const dims = [batch, width];
      const output = await session.run({
        input_ids: new ort.Tensor("int64", ids, dims),
        attention_mask: new ort.Tensor("int64", mask, dims),
        token_type_ids: new ort.Tensor("int64", types, dims),
      });

      const hidden = output["last_hidden_state"];
      if (!hidden) throw new Error("model returned no last_hidden_state");
      const data = hidden.data as Float32Array;
      const hiddenSize = hidden.dims[2] as number;
      if (hiddenSize !== LOCAL_MODEL_DIMENSIONS) {
        throw new Error(
          `model produced ${hiddenSize} dimensions, expected ${LOCAL_MODEL_DIMENSIONS}`,
        );
      }

      return encodings.map((_, row) => {
        // CLS pooling: bge trains the first token as the sequence representation.
        // Mean pooling here would produce vectors that look fine and rank worse.
        const start = row * width * hiddenSize;
        return normalize(Array.from(data.subarray(start, start + hiddenSize)));
      });
    },
  };
}

function truncate(encoding: ReturnType<typeof encode>): ReturnType<typeof encode> {
  if (encoding.ids.length <= MAX_TOKENS) return encoding;
  // Keep the closing separator so the sequence still ends the way the model expects.
  const ids = [
    ...encoding.ids.slice(0, MAX_TOKENS - 1),
    encoding.ids[encoding.ids.length - 1] as number,
  ];
  return { ids, attentionMask: ids.map(() => 1), tokenTypeIds: ids.map(() => 0) };
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

export function cosine(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] as number) * (b[i] as number);
  return sum;
}
