import { createRequire } from "node:module";
import {
  droppedSpeechGaps,
  silenceCuts,
  spliceGap,
  SHERPA_ERROR_PREFIX,
  SHERPA_RESULT_PREFIX,
  SHERPA_WINDOW_PREFIX,
  type SherpaWindow,
} from "./parakeet.js";
import { readWav } from "./wav.js";

interface Wave {
  samples: Float32Array;
  sampleRate: number;
}

interface SherpaOnnx {
  OfflineRecognizer: new (config: object) => {
    createStream(): { acceptWaveform(wave: Wave): void };
    decode(stream: unknown): void;
    getResult(stream: unknown): Omit<SherpaWindow, "offset">;
  };
}

const { wavPath, runtimePath, config } = JSON.parse(process.env.HYPERFRAMES_PARAKEET_INPUT ?? "{}");
const parentPid = process.ppid;

/** Leading silence moves the frame grid; 0.5 s recovered the dropped clause at every length tried. */
const RETRY_PAD_SECONDS = 0.5;
/** Audio kept on each side of a skipped gap when it is decoded on its own. */
const GAP_MARGIN_SECONDS = 0.5;

function decodeWindow(
  recognizer: InstanceType<SherpaOnnx["OfflineRecognizer"]>,
  wave: Wave,
  padSeconds = 0,
): Omit<SherpaWindow, "offset"> {
  const pad = Math.round(padSeconds * wave.sampleRate);
  const samples = new Float32Array(pad + wave.samples.length);
  samples.set(wave.samples, pad);
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples });
  recognizer.decode(stream);
  const { tokens, timestamps, durations } = recognizer.getResult(stream);
  return { tokens, timestamps: timestamps.map((t) => Math.max(0, t - padSeconds)), durations };
}

try {
  const sherpa = createRequire(import.meta.url)(runtimePath) as SherpaOnnx;
  const recognizer = new sherpa.OfflineRecognizer(config);
  const wave = readWav(wavPath);
  const cuts = silenceCuts(wave.samples, wave.sampleRate);
  const windows: SherpaWindow[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    // A SIGKILLed CLI cannot stop us, and nobody would read the result.
    if (process.ppid !== parentPid) throw new Error("the CLI exited, so the decode stopped");
    const slice = {
      sampleRate: wave.sampleRate,
      samples: wave.samples.subarray(cuts[k], cuts[k + 1]),
    };
    let decoded = decodeWindow(recognizer, slice);
    const gaps = droppedSpeechGaps(slice.samples, slice.sampleRate, decoded);
    let spliced = decoded;
    for (const [from, to] of gaps) {
      const lo = Math.max(0, from - GAP_MARGIN_SECONDS);
      const at = (seconds: number) => Math.round(seconds * slice.sampleRate);
      const samples = slice.samples.subarray(at(lo), at(to + GAP_MARGIN_SECONDS));
      const patch = decodeWindow(
        recognizer,
        { sampleRate: slice.sampleRate, samples },
        RETRY_PAD_SECONDS,
      );
      spliced = spliceGap(spliced, patch, lo, [from, to]);
    }
    if (spliced.tokens.length > decoded.tokens.length) decoded = spliced;
    else if (gaps.length > 0) {
      const retry = decodeWindow(recognizer, slice, RETRY_PAD_SECONDS);
      if (retry.tokens.length > decoded.tokens.length) decoded = retry;
    }
    const window = { offset: cuts[k]! / wave.sampleRate, ...decoded };
    windows.push(window);
    const through = cuts[k + 1]! / wave.sampleRate;
    process.stdout.write(`${SHERPA_WINDOW_PREFIX}${JSON.stringify({ window, through })}\n`);
  }
  process.stdout.write(`${SHERPA_RESULT_PREFIX}${JSON.stringify(windows)}\n`);
} catch (err) {
  // One line: the reader takes the prefixed line, and the loader's error spans several.
  const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
  // Rethrow after the flush: a pipe write is asynchronous on macOS and a crash would drop it.
  process.stderr.write(`${SHERPA_ERROR_PREFIX}${message}\n`, () => {
    throw err;
  });
}
