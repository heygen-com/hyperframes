const CRF_MAX_BY_FORMAT: Record<string, number> = { mp4: 51, webm: 63 };
const VIDEO_BITRATE = /^\d+(\.\d+)?[kKmMgG]?$/;
const VIDEO_FRAME_FORMATS = ["auto", "jpg", "png"] as const;
const HDR_MODES = ["auto", "force-hdr", "force-sdr"] as const;
const PRORES_PROFILES = ["4444", "hq", "422", "lt", "proxy"] as const;

interface EncoderOptions {
  gifLoop?: number;
  crf?: number;
  videoBitrate?: string;
  videoFrameFormat?: (typeof VIDEO_FRAME_FORMATS)[number];
  hdrMode?: (typeof HDR_MODES)[number];
  proresProfile?: (typeof PRORES_PROFILES)[number];
  keyframeIntervalSeconds?: number;
  maxBitrate?: string;
  bufferSize?: string;
}

export interface EncoderOptionsBody {
  gifLoop?: unknown;
  crf?: unknown;
  videoBitrate?: unknown;
  videoFrameFormat?: unknown;
  hdrMode?: unknown;
  proresProfile?: unknown;
  keyframeIntervalSeconds?: unknown;
  maxBitrate?: unknown;
  bufferSize?: unknown;
}

type Parsed = { ok: true; options: EncoderOptions } | { ok: false; error: string };

const isSet = (value: unknown) => value !== undefined && value !== null;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function parseCrf(crf: unknown, format: string, max: number): Parsed {
  if (typeof crf !== "number" || !Number.isInteger(crf) || crf < 0 || crf > max) {
    return { ok: false, error: `crf must be an integer from 0 to ${max} for ${format}` };
  }
  return { ok: true, options: { crf } };
}

function parseVideoBitrate(videoBitrate: unknown): Parsed {
  if (typeof videoBitrate !== "string" || !VIDEO_BITRATE.test(videoBitrate)) {
    return { ok: false, error: 'videoBitrate must look like "10M", "2500k" or "8000000"' };
  }
  return { ok: true, options: { videoBitrate } };
}

function parseRateControl(body: EncoderOptionsBody, format: string): Parsed {
  const max = CRF_MAX_BY_FORMAT[format];
  if (max === undefined) return { ok: true, options: {} };
  if (isSet(body.crf) && isSet(body.videoBitrate)) {
    return { ok: false, error: "use either crf or videoBitrate, not both" };
  }
  if (isSet(body.crf)) return parseCrf(body.crf, format, max);
  if (isSet(body.videoBitrate)) return parseVideoBitrate(body.videoBitrate);
  return { ok: true, options: {} };
}

function parseKeyframeInterval(value: unknown): Parsed {
  if (typeof value !== "number" || !(value > 0)) {
    return { ok: false, error: "keyframeIntervalSeconds must be a positive number of seconds" };
  }
  return { ok: true, options: { keyframeIntervalSeconds: value } };
}

function parseBitrateField(name: "maxBitrate" | "bufferSize", value: unknown): Parsed {
  if (typeof value !== "string" || !VIDEO_BITRATE.test(value)) {
    return { ok: false, error: `${name} must look like "8M", "5000k" or "8000000"` };
  }
  return { ok: true, options: { [name]: value } };
}

const DELIVERY_FIELDS = [
  ["keyframeIntervalSeconds", parseKeyframeInterval],
  ["maxBitrate", (value: unknown) => parseBitrateField("maxBitrate", value)],
  ["bufferSize", (value: unknown) => parseBitrateField("bufferSize", value)],
] as const;

function parseDelivery(body: EncoderOptionsBody, format: string): Parsed {
  const present = DELIVERY_FIELDS.filter(([name]) => isSet(body[name]));
  if (present.length === 0) return { ok: true, options: {} };
  if (format !== "mp4") {
    return { ok: false, error: "keyframeIntervalSeconds and maxBitrate apply to mp4 renders" };
  }
  if (isSet(body.bufferSize) && !isSet(body.maxBitrate)) {
    return { ok: false, error: "bufferSize requires maxBitrate" };
  }
  const options: EncoderOptions = {};
  for (const [name, parse] of present) {
    const parsed = parse(body[name]);
    if (!parsed.ok) return parsed;
    Object.assign(options, parsed.options);
  }
  return { ok: true, options };
}

function parseProres(value: unknown, format: string): Parsed {
  if (!isSet(value)) return { ok: true, options: {} };
  if (!oneOf(value, PRORES_PROFILES)) {
    return { ok: false, error: `proresProfile must be one of ${PRORES_PROFILES.join(", ")}` };
  }
  return { ok: true, options: format === "mov" ? { proresProfile: value } : {} };
}

/** Explicit encoder overrides from a render request. MOV (ProRes) takes no rate control. */
export function parseEncoderOptions(body: EncoderOptionsBody, format: string): Parsed {
  const rate = parseRateControl(body, format);
  if (!rate.ok) return rate;
  const delivery = parseDelivery(body, format);
  if (!delivery.ok) return delivery;
  const prores = parseProres(body.proresProfile, format);
  if (!prores.ok) return prores;
  const options: EncoderOptions = { ...rate.options, ...delivery.options, ...prores.options };
  if (isSet(body.gifLoop)) {
    if (
      typeof body.gifLoop !== "number" ||
      !Number.isInteger(body.gifLoop) ||
      body.gifLoop < 0 ||
      body.gifLoop > 65535
    ) {
      return { ok: false, error: "gifLoop must be an integer from 0 to 65535" };
    }
    if (format === "gif") options.gifLoop = body.gifLoop;
  }
  if (isSet(body.videoFrameFormat)) {
    if (!oneOf(body.videoFrameFormat, VIDEO_FRAME_FORMATS)) {
      return {
        ok: false,
        error: `videoFrameFormat must be one of ${VIDEO_FRAME_FORMATS.join(", ")}`,
      };
    }
    options.videoFrameFormat = body.videoFrameFormat;
  }
  if (isSet(body.hdrMode)) {
    if (!oneOf(body.hdrMode, HDR_MODES)) {
      return { ok: false, error: `hdrMode must be one of ${HDR_MODES.join(", ")}` };
    }
    options.hdrMode = body.hdrMode;
  }
  return { ok: true, options };
}

export function encoderJobOptions(opts: EncoderOptions): Omit<EncoderOptions, "gifLoop"> {
  const { crf, videoBitrate, keyframeIntervalSeconds, maxBitrate, bufferSize } = opts;
  return {
    ...(crf !== undefined ? { crf } : {}),
    ...(videoBitrate ? { videoBitrate } : {}),
    ...(keyframeIntervalSeconds !== undefined ? { keyframeIntervalSeconds } : {}),
    ...(maxBitrate ? { maxBitrate } : {}),
    ...(bufferSize ? { bufferSize } : {}),
    ...(opts.videoFrameFormat ? { videoFrameFormat: opts.videoFrameFormat } : {}),
    ...(opts.hdrMode ? { hdrMode: opts.hdrMode } : {}),
  };
}
