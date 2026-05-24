// Supertonic 3 inference runtime — a faithful TypeScript port of the upstream
// Node reference implementation (supertonic/nodejs/helper.js). The pipeline
// runs entirely in-process via onnxruntime-node: no Python, no subprocess.
//
// Stages: Unicode tokenization → duration prediction → text encoding →
// Gaussian latent sampling → iterative flow-matching denoise → vocoder.
// The numeric logic mirrors upstream exactly; only types and ESM/TS idioms
// were added. See https://github.com/supertone-inc/supertonic.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-node";

const AVAILABLE_LANGS = [
  "en",
  "ko",
  "ja",
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
  "na",
] as const;

export type SupertonicLang = (typeof AVAILABLE_LANGS)[number];

export function isSupertonicLang(value: string): value is SupertonicLang {
  return (AVAILABLE_LANGS as readonly string[]).includes(value);
}

export const SUPPORTED_LANGS = AVAILABLE_LANGS;

// ---------------------------------------------------------------------------
// Config & tensor helpers
// ---------------------------------------------------------------------------

interface TtsConfig {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

type Nested = number | Nested[];

/** Recursively flatten a (possibly ragged) nested number array — `arr.flat(Infinity)`. */
function flatten(arr: Nested[]): number[] {
  const out: number[] = [];
  const walk = (x: Nested): void => {
    if (Array.isArray(x)) {
      for (const item of x) walk(item);
    } else {
      out.push(x);
    }
  };
  for (const item of arr) walk(item);
  return out;
}

function arrayToTensor(array: Nested[], dims: number[]): ort.Tensor {
  return new ort.Tensor("float32", Float32Array.from(flatten(array)), dims);
}

function intArrayToTensor(array: Nested[], dims: number[]): ort.Tensor {
  const flat = flatten(array);
  return new ort.Tensor("int64", BigInt64Array.from(flat.map((x) => BigInt(x))), dims);
}

function tensorToNumbers(t: ort.Tensor): number[] {
  return Array.from(t.data as ArrayLike<number>);
}

/** Convert per-item lengths to a [B, 1, maxLen] binary mask. */
function lengthToMask(lengths: number[], maxLen?: number): number[][][] {
  const max = maxLen ?? Math.max(...lengths);
  const mask: number[][][] = [];
  for (const len of lengths) {
    const row: number[] = [];
    for (let j = 0; j < max; j++) {
      row.push(j < len ? 1.0 : 0.0);
    }
    mask.push([row]); // [B, 1, maxLen]
  }
  return mask;
}

function getLatentMask(
  wavLengths: number[],
  baseChunkSize: number,
  chunkCompressFactor: number,
): number[][][] {
  const latentSize = baseChunkSize * chunkCompressFactor;
  const latentLengths = wavLengths.map((len) => Math.floor((len + latentSize - 1) / latentSize));
  return lengthToMask(latentLengths);
}

// ---------------------------------------------------------------------------
// Unicode text processing
// ---------------------------------------------------------------------------

class UnicodeProcessor {
  private readonly indexer: Record<string, number>;

  constructor(unicodeIndexerJsonPath: string) {
    this.indexer = JSON.parse(readFileSync(unicodeIndexerJsonPath, "utf8"));
  }

  private preprocessText(text: string, lang: string): string {
    text = text.normalize("NFKD");

    // Remove emojis (wide Unicode range).
    const emojiPattern =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
    text = text.replace(emojiPattern, "");

    const replacements: Record<string, string> = {
      "–": "-",
      "‑": "-",
      "—": "-",
      _: " ",
      "“": '"',
      "”": '"',
      "‘": "'",
      "’": "'",
      "´": "'",
      "`": "'",
      "[": " ",
      "]": " ",
      "|": " ",
      "/": " ",
      "#": " ",
      "→": " ",
      "←": " ",
    };
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replaceAll(k, v);
    }

    text = text.replace(/[♥☆♡©\\]/g, "");

    const exprReplacements: Record<string, string> = {
      "@": " at ",
      "e.g.,": "for example, ",
      "i.e.,": "that is, ",
    };
    for (const [k, v] of Object.entries(exprReplacements)) {
      text = text.replaceAll(k, v);
    }

    // Fix spacing around punctuation.
    text = text.replace(/ ,/g, ",");
    text = text.replace(/ \./g, ".");
    text = text.replace(/ !/g, "!");
    text = text.replace(/ \?/g, "?");
    text = text.replace(/ ;/g, ";");
    text = text.replace(/ :/g, ":");
    text = text.replace(/ '/g, "'");

    // Collapse duplicate quotes.
    while (text.includes('""')) text = text.replace('""', '"');
    while (text.includes("''")) text = text.replace("''", "'");
    while (text.includes("``")) text = text.replace("``", "`");

    text = text.replace(/\s+/g, " ").trim();

    // Append a period if it doesn't already end with terminal punctuation.
    if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) {
      text += ".";
    }

    if (!AVAILABLE_LANGS.includes(lang as SupertonicLang)) {
      throw new Error(`Invalid language: ${lang}. Available: ${AVAILABLE_LANGS.join(", ")}`);
    }

    return `<${lang}>${text}</${lang}>`;
  }

  private textToUnicodeValues(text: string): number[] {
    return Array.from(text).map((char) => char.charCodeAt(0));
  }

  call(textList: string[], langList: string[]): { textIds: number[][]; textMask: number[][][] } {
    const processedTexts = textList.map((t, i) => this.preprocessText(t, langList[i]!));
    const textIdsLengths = processedTexts.map((t) => t.length);
    const maxLen = Math.max(...textIdsLengths);

    const textIds: number[][] = [];
    for (const processed of processedTexts) {
      const row = new Array<number>(maxLen).fill(0);
      const unicodeVals = this.textToUnicodeValues(processed);
      for (let j = 0; j < unicodeVals.length; j++) {
        row[j] = this.indexer[String(unicodeVals[j])] ?? 0;
      }
      textIds.push(row);
    }

    const textMask = lengthToMask(textIdsLengths);
    return { textIds, textMask };
  }
}

// ---------------------------------------------------------------------------
// Voice style
// ---------------------------------------------------------------------------

// Exported as the return type of loadVoiceStyle (required for declaration emit).
// fallow-ignore-next-line unused-exports
export class Style {
  constructor(
    readonly ttl: ort.Tensor,
    readonly dp: ort.Tensor,
  ) {}
}

interface VoiceStyleJson {
  style_ttl: { dims: number[]; data: Nested[] };
  style_dp: { dims: number[]; data: Nested[] };
}

/**
 * Load one or more preset voice-style JSON files into a batched Style. All
 * files must share the same tensor dimensions (they do, for v3 presets).
 */
export function loadVoiceStyle(voiceStylePaths: string[]): Style {
  const bsz = voiceStylePaths.length;

  const first: VoiceStyleJson = JSON.parse(readFileSync(voiceStylePaths[0]!, "utf8"));
  const ttlDims = first.style_ttl.dims;
  const dpDims = first.style_dp.dims;

  const ttlDim1 = ttlDims[1]!;
  const ttlDim2 = ttlDims[2]!;
  const dpDim1 = dpDims[1]!;
  const dpDim2 = dpDims[2]!;

  const ttlFlat = new Float32Array(bsz * ttlDim1 * ttlDim2);
  const dpFlat = new Float32Array(bsz * dpDim1 * dpDim2);

  for (let i = 0; i < bsz; i++) {
    const voiceStyle: VoiceStyleJson = JSON.parse(readFileSync(voiceStylePaths[i]!, "utf8"));
    ttlFlat.set(flatten(voiceStyle.style_ttl.data), i * ttlDim1 * ttlDim2);
    dpFlat.set(flatten(voiceStyle.style_dp.data), i * dpDim1 * dpDim2);
  }

  const ttlStyle = new ort.Tensor("float32", ttlFlat, [bsz, ttlDim1, ttlDim2]);
  const dpStyle = new ort.Tensor("float32", dpFlat, [bsz, dpDim1, dpDim2]);
  return new Style(ttlStyle, dpStyle);
}

// ---------------------------------------------------------------------------
// TextToSpeech pipeline
// ---------------------------------------------------------------------------

// Exported as the return type of loadTextToSpeech (required for declaration emit).
// fallow-ignore-next-line unused-exports
export class TextToSpeech {
  readonly sampleRate: number;
  private readonly baseChunkSize: number;
  private readonly chunkCompressFactor: number;
  private readonly ldim: number;

  constructor(
    cfgs: TtsConfig,
    private readonly textProcessor: UnicodeProcessor,
    private readonly dpOrt: ort.InferenceSession,
    private readonly textEncOrt: ort.InferenceSession,
    private readonly vectorEstOrt: ort.InferenceSession,
    private readonly vocoderOrt: ort.InferenceSession,
  ) {
    this.sampleRate = cfgs.ae.sample_rate;
    this.baseChunkSize = cfgs.ae.base_chunk_size;
    this.chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
    this.ldim = cfgs.ttl.latent_dim;
  }

  private sampleNoisyLatent(duration: number[]): {
    noisyLatent: number[][][];
    latentMask: number[][][];
  } {
    const wavLenMax = Math.max(...duration) * this.sampleRate;
    const wavLengths = duration.map((d) => Math.floor(d * this.sampleRate));
    const chunkSize = this.baseChunkSize * this.chunkCompressFactor;
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
    const latentDim = this.ldim * this.chunkCompressFactor;

    const noisyLatent: number[][][] = [];
    for (let b = 0; b < duration.length; b++) {
      const batch: number[][] = [];
      for (let d = 0; d < latentDim; d++) {
        const row: number[] = [];
        for (let t = 0; t < latentLen; t++) {
          // Box-Muller transform for a standard normal sample.
          const eps = 1e-10;
          const u1 = Math.max(eps, Math.random());
          const u2 = Math.random();
          row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
        }
        batch.push(row);
      }
      noisyLatent.push(batch);
    }

    const latentMask = getLatentMask(wavLengths, this.baseChunkSize, this.chunkCompressFactor);

    for (let b = 0; b < noisyLatent.length; b++) {
      for (let d = 0; d < noisyLatent[b]!.length; d++) {
        for (let t = 0; t < noisyLatent[b]![d]!.length; t++) {
          noisyLatent[b]![d]![t]! *= latentMask[b]![0]![t]!;
        }
      }
    }

    return { noisyLatent, latentMask };
  }

  private async infer(
    textList: string[],
    langList: string[],
    style: Style,
    totalStep: number,
    speed = 1.05,
  ): Promise<{ wav: number[]; duration: number[] }> {
    if (textList.length !== style.ttl.dims[0]) {
      throw new Error("Number of texts must match number of style vectors");
    }
    const bsz = textList.length;
    const { textIds, textMask } = this.textProcessor.call(textList, langList);
    const textIdsShape = [bsz, textIds[0]!.length];
    const textMaskShape = [bsz, 1, textMask[0]![0]!.length];

    const textMaskTensor = arrayToTensor(textMask, textMaskShape);

    const dpResult = await this.dpOrt.run({
      text_ids: intArrayToTensor(textIds, textIdsShape),
      style_dp: style.dp,
      text_mask: textMaskTensor,
    });

    const durOnnx = tensorToNumbers(dpResult.duration!);
    // Faster speech → shorter duration.
    for (let i = 0; i < durOnnx.length; i++) {
      durOnnx[i]! /= speed;
    }

    const textEncResult = await this.textEncOrt.run({
      text_ids: intArrayToTensor(textIds, textIdsShape),
      style_ttl: style.ttl,
      text_mask: textMaskTensor,
    });
    const textEmbTensor = textEncResult.text_emb!;

    const { noisyLatent, latentMask } = this.sampleNoisyLatent(durOnnx);
    const latentShape = [bsz, noisyLatent[0]!.length, noisyLatent[0]![0]!.length];
    const latentMaskShape = [bsz, 1, latentMask[0]![0]!.length];

    const latentMaskTensor = arrayToTensor(latentMask, latentMaskShape);

    const totalStepTensor = arrayToTensor(new Array<number>(bsz).fill(totalStep), [bsz]);

    for (let step = 0; step < totalStep; step++) {
      const currentStepArray = new Array<number>(bsz).fill(step);

      const vectorEstResult = await this.vectorEstOrt.run({
        noisy_latent: arrayToTensor(noisyLatent, latentShape),
        text_emb: textEmbTensor,
        style_ttl: style.ttl,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: arrayToTensor(currentStepArray, [bsz]),
      });

      const denoisedLatent = tensorToNumbers(vectorEstResult.denoised_latent!);

      let idx = 0;
      for (let b = 0; b < noisyLatent.length; b++) {
        for (let d = 0; d < noisyLatent[b]!.length; d++) {
          for (let t = 0; t < noisyLatent[b]![d]!.length; t++) {
            noisyLatent[b]![d]![t] = denoisedLatent[idx++]!;
          }
        }
      }
    }

    const vocoderResult = await this.vocoderOrt.run({
      latent: arrayToTensor(noisyLatent, latentShape),
    });

    return { wav: tensorToNumbers(vocoderResult.wav_tts!), duration: durOnnx };
  }

  /**
   * Single-speaker synthesis with automatic chunking for long text. Chunks are
   * joined with `silenceDuration` seconds of silence.
   */
  async call(
    text: string,
    lang: string,
    style: Style,
    totalStep: number,
    speed = 1.05,
    silenceDuration = 0.3,
  ): Promise<{ wav: number[]; duration: number[] }> {
    if (style.ttl.dims[0] !== 1) {
      throw new Error("Single speaker text to speech only supports a single style");
    }
    const maxLen = lang === "ko" || lang === "ja" ? 120 : 300;
    const textList = chunkText(text, maxLen);

    let wavCat: number[] | null = null;
    let durCat = 0;

    for (const chunk of textList) {
      const { wav, duration } = await this.infer([chunk], [lang], style, totalStep, speed);
      if (wavCat === null) {
        wavCat = wav;
        durCat = duration[0]!;
      } else {
        const silenceLen = Math.floor(silenceDuration * this.sampleRate);
        const silence = new Array<number>(silenceLen).fill(0);
        wavCat = [...wavCat, ...silence, ...wav];
        durCat += duration[0]! + silenceDuration;
      }
    }

    return { wav: wavCat ?? [], duration: [durCat] };
  }

  /** Batch synthesis (one style + lang per text), no automatic chunking. */
  async batch(
    textList: string[],
    langList: string[],
    style: Style,
    totalStep: number,
    speed = 1.05,
  ): Promise<{ wav: number[]; duration: number[] }> {
    return this.infer(textList, langList, style, totalStep, speed);
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Load the four ONNX models + config + tokenizer from `onnxDir`. CPU only;
 * upstream has not yet shipped a GPU path.
 */
export async function loadTextToSpeech(onnxDir: string): Promise<TextToSpeech> {
  const cfgs: TtsConfig = JSON.parse(readFileSync(join(onnxDir, "tts.json"), "utf8"));
  const opts = {};

  const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
    ort.InferenceSession.create(join(onnxDir, "duration_predictor.onnx"), opts),
    ort.InferenceSession.create(join(onnxDir, "text_encoder.onnx"), opts),
    ort.InferenceSession.create(join(onnxDir, "vector_estimator.onnx"), opts),
    ort.InferenceSession.create(join(onnxDir, "vocoder.onnx"), opts),
  ]);

  const textProcessor = new UnicodeProcessor(join(onnxDir, "unicode_indexer.json"));
  return new TextToSpeech(cfgs, textProcessor, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt);
}

/** Write a mono 16-bit PCM WAV file. Samples are clamped to [-1, 1]. */
export function writeWavFile(filename: string, audioData: number[], sampleRate: number): void {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = (audioData.length * bitsPerSample) / 8;

  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]!));
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }

  writeFileSync(filename, buffer);
}

/** Split text into <= maxLen segments on paragraph then sentence boundaries. */
function chunkText(text: string, maxLen = 300): string[] {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n+/)
    .filter((p) => p.trim());

  const chunks: string[] = [];

  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim();
    if (!paragraph) continue;

    const sentences = paragraph.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    );

    let currentChunk = "";
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length + 1 <= maxLen) {
        currentChunk += (currentChunk ? " " : "") + sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
  }

  return chunks;
}
