export interface InPageEncodeInput {
  enabled: boolean;
  captureMode: "drawelement" | "screenshot" | "beginframe";
  format: string;
  codec: string;
  hdr: boolean;
  transparent: boolean;
  workers: number;
  hls: boolean;
  videoLayer: boolean;
  encoderSupported: boolean;
}

export type InPageEncodeDecision = { eligible: true } | { eligible: false; reason: string };

export function resolveInPageEncode(input: InPageEncodeInput): InPageEncodeDecision {
  const blocker = (
    [
      [!input.enabled, "disabled"],
      [input.captureMode !== "drawelement", "capture is not drawElement"],
      [input.format !== "mp4", "output is not mp4"],
      [input.codec !== "h264", "codec is not h264"],
      [input.hdr, "hdr"],
      [input.transparent, "transparent"],
      [input.workers !== 1, "parallel workers"],
      [input.hls, "hls"],
      [input.videoLayer, "video layer passthrough"],
      [!input.encoderSupported, "page encoder unsupported"],
    ] as const
  ).find(([blocked]) => blocked);
  return blocker ? { eligible: false, reason: blocker[1] } : { eligible: true };
}
