export interface ToneMapSourceColour {
  colorSpace?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
}

function known(value: string | undefined): string | undefined {
  return value && value !== "unknown" && value !== "reserved" ? value : undefined;
}

/**
 * HDR to SDR BT.709 with zscale and hable. zscale reads each frame's own tags, so only those the
 * first frame lacks are set: from ffprobe, which may see the container's, else BT.2020.
 */
export function hdrToSdrToneMapFilter(
  probed: ToneMapSourceColour,
  firstFrame: ToneMapSourceColour,
): string {
  const fill = (key: keyof ToneMapSourceColour, fallback?: string) =>
    known(firstFrame[key]) ? undefined : (known(probed[key]) ?? fallback);
  const tags = [
    ["colorspace", fill("colorSpace", "bt2020nc")],
    ["color_primaries", fill("colorPrimaries", "bt2020")],
    ["color_trc", fill("colorTransfer")],
  ].filter(([, value]) => value);
  const setTags = tags.length ? `setparams=${tags.map((tag) => tag.join("=")).join(":")},` : "";
  return `${setTags}zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv`;
}

/** ffmpeg args printing the first shown frame's tags; ffprobe's packet-bounded reads miss edit-list pre-roll. */
export function firstFrameColourArgs(videoPath: string): string[] {
  return [
    ...["-hide_banner", "-nostats", "-i", videoPath, "-map", "0:v:0", "-frames:v", "1"],
    ...["-vf", "showinfo", "-f", "null", "-"],
  ];
}

export function parseFirstFrameColour(stderr: string): ToneMapSourceColour {
  const tags = / color_space:(\S+) color_primaries:(\S+) color_trc:(\S+)/.exec(stderr);
  return tags ? { colorSpace: tags[1], colorPrimaries: tags[2], colorTransfer: tags[3] } : {};
}
