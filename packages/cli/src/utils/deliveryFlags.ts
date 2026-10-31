import { PRORES_PROFILE_NAMES, appendRateCapArgs, isProresProfile } from "@hyperframes/engine";
import type { ProresProfile } from "@hyperframes/engine";
import { errorBox } from "../ui/format.js";
import { failUsage } from "./commandResult.js";

/** The delivery flags `hyperframes render` and `hyperframes lambda render` share. */
export const deliveryFlagArgs = {
  "keyframe-interval": {
    type: "string",
    description:
      "MP4 keyframe interval in seconds, such as 2 (a keyframe at least this often; default: encoder's choice).",
  },
  "max-bitrate": {
    type: "string",
    description:
      "MP4 peak video bitrate cap, such as 8M, kept alongside the quality target (default: uncapped).",
  },
  "buffer-size": {
    type: "string",
    description: "Buffer for --max-bitrate, such as 16M (default: twice --max-bitrate).",
  },
  "prores-profile": {
    type: "string",
    description: `MOV ProRes profile: ${PRORES_PROFILE_NAMES.join(", ")} (default 4444, keeps alpha; the others drop it).`,
  },
} as const;

export interface DeliveryFlagValues {
  keyframeIntervalSeconds?: number;
  maxBitrate?: string;
  bufferSize?: string;
  proresProfile?: ProresProfile;
}

interface DeliveryFlagArgs {
  "keyframe-interval"?: string;
  "max-bitrate"?: string;
  "buffer-size"?: string;
  "prores-profile"?: string;
}

/** Parse the delivery flags, exiting with a usage error on a value the encoder would refuse. */
export function parseDeliveryFlags(args: DeliveryFlagArgs): DeliveryFlagValues {
  const interval = args["keyframe-interval"]?.trim();
  const maxBitrate = args["max-bitrate"]?.trim();
  const bufferSize = args["buffer-size"]?.trim();
  const values: DeliveryFlagValues = {};
  if (interval !== undefined) {
    const seconds = Number(interval);
    if (interval === "" || !Number.isFinite(seconds) || seconds <= 0) {
      errorBox(
        "Invalid keyframe-interval",
        `Got "${interval}". Must be a positive number of seconds.`,
      );
      failUsage();
    }
    values.keyframeIntervalSeconds = seconds;
  }
  const profile = args["prores-profile"]?.trim();
  if (profile !== undefined) {
    if (!isProresProfile(profile)) {
      errorBox(
        "Invalid prores-profile",
        `Got "${profile}". Must be one of ${PRORES_PROFILE_NAMES.join(", ")}.`,
      );
      failUsage();
    }
    values.proresProfile = profile;
  }
  if (maxBitrate !== undefined) values.maxBitrate = maxBitrate;
  if (bufferSize !== undefined) values.bufferSize = bufferSize;
  try {
    appendRateCapArgs([], values);
  } catch (error) {
    errorBox("Invalid bitrate cap", error instanceof Error ? error.message : String(error));
    failUsage();
  }
  return values;
}
