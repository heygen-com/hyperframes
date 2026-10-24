import { HyperframesCloudClient } from "../../../cloud/_gen/client.js";
import { uploadAssetViaDirectUpload } from "../../../cloud/upload.js";
import { randomUUID } from "node:crypto";
import {
  medianInterval,
  rhythm,
  snapper,
  type AudioAnalysisProvider,
  type AudioCapability,
  type AudioSignal,
  type Snapper,
} from "@hyperframes/core/audio-analysis";
import {
  AVAILABLE,
  encodeWav,
  perSignal,
  rounded,
  serviceAccess,
  serviceFailure,
  type ServiceAccess,
  unavailable,
} from "./shared.js";

/**
 * POST an asset-backed request to the configured audio service with a fresh Idempotency-Key.
 * Uploads are 16 kHz mono WAV through the same origin's direct-upload routes.
 * Responses may be bare or wrapped in `data`; times start at the uploaded audio's beginning.
 * Unavailable capabilities are omitted. Other HTTP statuses fail with the service's error.
 */
export interface AudioApiRequest {
  version: 1;
  capabilities: AudioApiCapability[];
  audio: { type: "asset_id"; asset_id: string };
}

export type AudioApiCapability = "beats" | "downbeats" | "sections" | "describe";

export interface AudioApiResponse {
  version: 1;
  /** What answered, as the service wants it reported. */
  source?: string;
  /** The finest step the service's times resolve, in seconds. */
  time_resolution_seconds?: number;
  beats?: { times: number[] };
  downbeats?: { times: number[]; meter?: number | null };
  sections?: { spans: { start: number; end: number; label?: string }[] };
  describe?: { text?: string; tags: { label: string; score: number }[] };
}

const URL_ENV = "HYPERFRAMES_AUDIO_API_URL";
const KEY_ENV = "HYPERFRAMES_AUDIO_API_KEY";
const TIMEOUT_ENV = "HYPERFRAMES_AUDIO_API_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS = 120_000;
const UPLOAD_RATE = 16_000;
const SINC_ZEROS = 16;
const ROLLOFF = 0.9;
const SINC_STEPS = 512;
const HANN_SINC = Float32Array.from({ length: SINC_ZEROS * SINC_STEPS + 2 }, (_, k) => {
  const x = k / SINC_STEPS;
  if (x >= SINC_ZEROS) return 0;
  const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  return sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / SINC_ZEROS));
});

/** Windowed-sinc resampling with its cutoff just under the lower Nyquist, so nothing above it folds back in. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const step = from / to;
  const scale = Math.min(1, to / from) * ROLLOFF;
  const reach = SINC_ZEROS / scale;
  const output = new Float32Array(Math.round(input.length / step));
  for (let i = 0; i < output.length; i++) {
    const center = i * step;
    const last = Math.min(input.length - 1, Math.floor(center + reach));
    let sum = 0;
    let weights = 0;
    for (let n = Math.max(0, Math.ceil(center - reach)); n <= last; n++) {
      const at = Math.abs(n - center) * scale * SINC_STEPS;
      const k = Math.floor(at);
      const weight = HANN_SINC[k]! + (at - k) * (HANN_SINC[k + 1]! - HANN_SINC[k]!);
      sum += input[n]! * weight;
      weights += weight;
    }
    output[i] = weights ? sum / weights : 0;
  }
  return output;
}

/** Preserve a channel when destructive interference removes over 90% of its energy. */
function monoInput(channels: readonly Float32Array[]): Float32Array {
  const mono = new Float32Array(channels[0]?.length ?? 0);
  let loudest: Float32Array = mono;
  let loudestEnergy = 0;
  for (const channel of channels) {
    let energy = 0;
    for (let i = 0; i < mono.length; i++) {
      const value = channel[i]!;
      mono[i]! += value / channels.length;
      energy += value * value;
    }
    if (energy > loudestEnergy) {
      loudest = channel;
      loudestEnergy = energy;
    }
  }
  const monoEnergy = mono.reduce((energy, value) => energy + value * value, 0);
  return monoEnergy < loudestEnergy * 0.1 ? loudest : mono;
}

function uploaded(signal: AudioSignal): AudioSignal {
  return {
    sampleRate: UPLOAD_RATE,
    channels: [resample(monoInput(signal.channels), signal.sampleRate, UPLOAD_RATE)],
  };
}

/** Beats and downbeats come from one request; the others each from their own. */
const askedTogether = (capability: AudioApiCapability): AudioApiCapability[] =>
  capability === "beats" || capability === "downbeats" ? ["beats", "downbeats"] : [capability];

const access = () =>
  serviceAccess(
    { url: URL_ENV, key: KEY_ENV, timeout: TIMEOUT_ENV },
    "/v3/audio/analysis",
    DEFAULT_TIMEOUT_MS,
  );

async function granted(): Promise<ServiceAccess> {
  const found = await access();
  if (typeof found === "string") throw new Error(found);
  return found;
}

const isNumberList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((t) => typeof t === "number" && Number.isFinite(t));

function checked(capability: AudioApiCapability, body: AudioApiResponse): void {
  const value = body[capability] as Record<string, unknown> | undefined;
  if (!value || typeof value !== "object")
    throw new Error(`the service did not answer ${capability}`);
  const valid = {
    beats: () => isNumberList(value.times),
    downbeats: () => isNumberList(value.times),
    sections: () =>
      Array.isArray(value.spans) &&
      value.spans.every((s: { start?: unknown; end?: unknown }) => isNumberList([s.start, s.end])),
    describe: () =>
      Array.isArray(value.tags) &&
      value.tags.every(
        (t: { label?: unknown; score?: unknown }) =>
          typeof t.label === "string" && typeof t.score === "number",
      ),
  }[capability];
  if (!valid())
    throw new Error(`the service answered ${capability} in a shape this CLI cannot read`);
}

const uploadedAsset = perSignal(async (analyzed: AudioSignal) => {
  const { url, headers, timeoutMs } = await granted();
  const deadline = AbortSignal.timeout(timeoutMs);
  const boundedFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      redirect: "error",
      signal: deadline,
    });
  const client = new HyperframesCloudClient({
    baseUrl: new URL(url).origin,
    getAuthHeaders: () => headers,
    fetchImpl: boundedFetch,
  });
  const asset = await uploadAssetViaDirectUpload({
    client,
    bytes: new Uint8Array(encodeWav(uploaded(analyzed))),
    filename: "audio.wav",
    contentType: "audio/wav",
    idempotencyKey: randomUUID(),
    fetchImpl: boundedFetch,
  });
  return asset.asset_id;
});

async function ask(analyzed: AudioSignal, capabilities: AudioApiCapability[]) {
  const { url, headers, timeoutMs } = await granted();
  const request: AudioApiRequest = {
    version: 1,
    capabilities,
    audio: { type: "asset_id", asset_id: await uploadedAsset(analyzed) },
  };
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      ...headers,
      "idempotency-key": randomUUID(),
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw await serviceFailure(response, "the service");
  const body = (await response.json()) as { data?: AudioApiResponse } | null;
  return (body?.data ?? body ?? {}) as AudioApiResponse;
}

const requests = new Map<string, (signal: AudioSignal) => Promise<AudioApiResponse>>();

function answerFor(signal: AudioSignal, capability: AudioApiCapability) {
  const together = askedTogether(capability);
  const key = together.join(",");
  let request = requests.get(key);
  if (!request) requests.set(key, (request = perSignal((s) => ask(s, together))));
  return request(signal);
}

/** The signal's own beats, which an answer's times move onto when one is within a quarter of the answer's beat. */
function beatSnapper(signal: AudioSignal, beatSeconds: number | null): Snapper {
  const measured = rhythm(signal).beats.times;
  const period = beatSeconds ?? medianInterval(measured) ?? 0;
  return snapper(measured, period / 4, "signal beats");
}

function snappedBeats(signal: AudioSignal, body: AudioApiResponse) {
  const times = body.beats!.times;
  const onBeat = beatSnapper(signal, medianInterval(times));
  return { times: rounded(times.map(onBeat.snap)), snap: onBeat.report() };
}

function snappedDownbeats(signal: AudioSignal, body: AudioApiResponse) {
  const { times, meter = null } = body.downbeats!;
  const beat = body.beats ? medianInterval(body.beats.times) : null;
  const bar = medianInterval(times);
  const onBeat = beatSnapper(signal, beat ?? (bar && meter ? bar / meter : null));
  return { times: rounded(times.map(onBeat.snap)), meter, snap: onBeat.report() };
}

function snappedSections(signal: AudioSignal, body: AudioApiResponse) {
  const onBeat = beatSnapper(signal, null);
  const end = (signal.channels[0]?.length ?? 0) / signal.sampleRate;
  const move = (t: number) => (t <= 0 || t >= end ? t : onBeat.snap(t));
  const spans = body.sections!.spans.map((s) => ({
    ...s,
    start: rounded([move(s.start)])[0]!,
    end: rounded([move(s.end)])[0]!,
  }));
  return { spans, snap: onBeat.report() };
}

/** The answer for one capability, its times moved onto what the signal measured. */
function measured(capability: AudioApiCapability, signal: AudioSignal, body: AudioApiResponse) {
  const value =
    capability === "beats"
      ? snappedBeats(signal, body)
      : capability === "downbeats"
        ? snappedDownbeats(signal, body)
        : capability === "sections"
          ? snappedSections(signal, body)
          : body.describe!;
  return body.source ? { ...value, source: body.source } : value;
}

const API_CAPABILITIES: readonly AudioCapability[] = ["beats", "downbeats", "sections", "describe"];

/** HeyGen's audio analysis service, or another that speaks {@link AudioApiRequest} when the environment names one. */
export const apiProvider: AudioAnalysisProvider<AudioSignal> = {
  id: "api",
  local: false,
  capabilities: API_CAPABILITIES,
  async available() {
    const found = await access();
    return typeof found === "string" ? unavailable(found) : AVAILABLE;
  },
  async analyze(capability, signal) {
    const asked = capability as AudioApiCapability;
    const body = await answerFor(signal, asked);
    checked(asked, body);
    return measured(asked, signal, body);
  },
};
