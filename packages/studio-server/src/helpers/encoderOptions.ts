const CRF_MAX_BY_FORMAT: Record<string, number> = { mp4: 51, webm: 63 };
const VIDEO_BITRATE = /^\d+(\.\d+)?[kKmMgG]?$/;
const VIDEO_FRAME_FORMATS = ["auto", "jpg", "png"] as const;
const HDR_MODES = ["auto", "force-hdr", "force-sdr"] as const;
const CHROMA_SUBSAMPLINGS = ["420", "444"] as const;

interface EncoderOptions {
  crf?: number;
  videoBitrate?: string;
  videoFrameFormat?: (typeof VIDEO_FRAME_FORMATS)[number];
  hdrMode?: (typeof HDR_MODES)[number];
  chromaSubsampling?: (typeof CHROMA_SUBSAMPLINGS)[number];
}

export interface EncoderOptionsBody {
  crf?: unknown;
  videoBitrate?: unknown;
  videoFrameFormat?: unknown;
  hdrMode?: unknown;
  chromaSubsampling?: unknown;
  /** Read only to refuse 4:4:4 with GPU encoding; callers resolve `gpu` themselves. */
  gpu?: unknown;
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

/**
 * 4:4:4 needs SDR MP4 from the software encoder; anything else would come back 4:2:0
 * or fail mid-render, so refuse it here with a 400 instead.
 */
function parseChromaSubsampling(body: EncoderOptionsBody, format: string): Parsed {
  const chromaSubsampling = body.chromaSubsampling;
  if (!isSet(chromaSubsampling)) return { ok: true, options: {} };
  if (!oneOf(chromaSubsampling, CHROMA_SUBSAMPLINGS)) {
    return {
      ok: false,
      error: `chromaSubsampling must be one of ${CHROMA_SUBSAMPLINGS.join(", ")}`,
    };
  }
  if (chromaSubsampling === "444") {
    if (format !== "mp4") {
      return { ok: false, error: `chromaSubsampling "444" supports mp4 only (got ${format})` };
    }
    if (body.gpu === true) {
      return { ok: false, error: 'chromaSubsampling "444" requires the software encoder, not gpu' };
    }
    if (body.hdrMode === "force-hdr") {
      return { ok: false, error: 'chromaSubsampling "444" is SDR only, not force-hdr' };
    }
  }
  return { ok: true, options: { chromaSubsampling } };
}

/** Explicit encoder overrides from a render request. MOV (ProRes) takes no rate control. */
export function parseEncoderOptions(body: EncoderOptionsBody, format: string): Parsed {
  const rate = parseRateControl(body, format);
  if (!rate.ok) return rate;
  const options: EncoderOptions = { ...rate.options };
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
  const chroma = parseChromaSubsampling(body, format);
  if (!chroma.ok) return chroma;
  return { ok: true, options: { ...options, ...chroma.options } };
}
