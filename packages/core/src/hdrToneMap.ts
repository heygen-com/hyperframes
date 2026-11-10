export interface ToneMapSourceColour {
  colorSpace?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
}

export interface ToneMapFrameColour extends ToneMapSourceColour {
  keyframeTransfers?: readonly string[];
}

const BT2408_HLG_REFERENCE_WHITE_NITS = 203;
const SDR_NOMINAL_PEAK_NITS = 100;

/** One zscale serves a stream: only an all-HLG one takes HLG's white, so a mixed one's PQ stays as is. */
export const toneMapReferenceNits = (keyframeTransfers: readonly string[] | undefined): number =>
  keyframeTransfers?.length && keyframeTransfers.every((transfer) => transfer === "arib-std-b67")
    ? BT2408_HLG_REFERENCE_WHITE_NITS
    : SDR_NOMINAL_PEAK_NITS;

export const readsKeyframeTransfers = ({ colorTransfer }: ToneMapSourceColour): boolean =>
  colorTransfer === "arib-std-b67" || !known(colorTransfer);

function known(value: string | undefined): string | undefined {
  return value && value !== "unknown" && value !== "reserved" ? value : undefined;
}

/**
 * HDR to SDR BT.709 with zscale and hable. zscale reads each frame's own tags, so only those the
 * first frame lacks are set: from ffprobe, which may see the container's, else BT.2020.
 */
export function hdrToSdrToneMapFilter(
  probed: ToneMapSourceColour,
  firstFrame: ToneMapFrameColour,
  size?: { width: string; height: string },
): string {
  const fill = (key: keyof ToneMapSourceColour, fallback?: string) =>
    known(firstFrame[key]) ? undefined : (known(probed[key]) ?? fallback);
  const tags = [
    ["colorspace", fill("colorSpace", "bt2020nc")],
    ["color_primaries", fill("colorPrimaries", "bt2020")],
    ["color_trc", fill("colorTransfer")],
  ].filter(([, value]) => value);
  const setTags = tags.length ? `setparams=${tags.map((tag) => tag.join("=")).join(":")},` : "";
  const resizeBeforeToneMap = size ? `w=${size.width}:h=${size.height}:` : "";
  const stream = known(firstFrame.colorTransfer) ?? known(probed.colorTransfer);
  const npl = toneMapReferenceNits(
    firstFrame.keyframeTransfers?.map((transfer) =>
      transfer === "unspecified" ? (stream ?? transfer) : transfer,
    ),
  );
  return `${setTags}zscale=${resizeBeforeToneMap}t=linear:npl=${npl},tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv`;
}

/** ffmpeg args printing the first shown frame's tags; ffprobe's packet-bounded reads miss edit-list pre-roll. */
export function firstFrameColourArgs(videoPath: string): string[] {
  return [
    ...["-hide_banner", "-nostats", "-i", videoPath, "-map", "0:v:0", "-frames:v", "1"],
    ...["-vf", "showinfo", "-f", "null", "-"],
  ];
}

const SPS_UNIT_TYPES: Record<string, string> = { h264: "7", hevc: "33" };
const TRANSFER_NAMES: Record<string, string> = {
  "1": "bt709",
  "2": "unspecified",
  "16": "smpte2084",
  "18": "arib-std-b67",
};

/** ffmpeg args tracing the transfer of each SPS, in the header and in keyframes, without decoding a picture. */
export function keyframeTransferArgs(videoPath: string, codec?: string): string[] {
  const sps = codec ? SPS_UNIT_TYPES[codec] : undefined;
  const trace = sps ? `filter_units=pass_types=${sps},trace_headers` : "trace_headers";
  return [
    ...["-hide_banner", "-nostats", "-discard", "nokey", "-i", videoPath, "-map", "0:v:0"],
    ...["-c", "copy", "-bsf:v", trace, "-f", "null", "-"],
  ];
}

export const parseKeyframeTransfers = (stderr: string): string[] =>
  [...stderr.matchAll(/transfer_characteristics +[01]+ = (\d+)/g)].map(
    ([, code = ""]) => TRANSFER_NAMES[code] ?? `code ${code}`,
  );

export function parseFirstFrameColour(stderr: string): ToneMapSourceColour {
  const tags = / color_space:(\S+) color_primaries:(\S+) color_trc:(\S+)/.exec(stderr);
  return tags ? { colorSpace: tags[1], colorPrimaries: tags[2], colorTransfer: tags[3] } : {};
}
