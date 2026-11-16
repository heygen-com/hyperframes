import { existsSync } from "node:fs";
import { redactUrlQueryStrings } from "@hyperframes/core";
import { SELF_CONTAINED_FORMATS, mediaInputFormatArgs } from "@hyperframes/parsers/ff-binaries";
import { resolveRestrictPageNetwork } from "../config.js";
import { getFfmpegBinary, getFfprobeBinary } from "./ffmpegBinaries.js";

// The Lambda nodejs image (Amazon Linux 2023) ships the first; Debian/Ubuntu the second; macOS the third.
const CA_BUNDLES = [
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/ssl/cert.pem",
];

// Lambda's ffprobe 4.0 accepts these but not -reconnect_on_network_error; a stalled read fails after 30 s.
const RECONNECT_ARGS = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_delay_max", "2"];

export function selfContainedFormatArgs(): string[] {
  return resolveRestrictPageNetwork() ? ["-format_whitelist", SELF_CONTAINED_FORMATS] : [];
}

/** Every input of composition media reads only demuxers that open nothing by themselves. ffmpeg and ffprobe skip TLS certificate checks unless told to; an https input must be verified, and on a render service be a self-contained container that names only HTTPS. */
export function urlInputArgs(
  input: string,
  {
    tool = "ffmpeg",
    caBundles = CA_BUNDLES,
  }: { tool?: "ffmpeg" | "ffprobe"; caBundles?: readonly string[] } = {},
): string[] {
  const mediaFormats = () =>
    mediaInputFormatArgs(tool === "ffprobe" ? getFfprobeBinary() : getFfmpegBinary());
  if (!/^https:\/\//i.test(input)) return mediaFormats();
  const caFile = caBundles.find((path) => existsSync(path));
  if (!caFile) {
    throw new Error(
      `[FFmpeg] cannot verify TLS for an https input: no CA bundle at ${caBundles.join(", ")}`,
    );
  }
  const networkRetry = tool === "ffmpeg" ? ["-reconnect_on_network_error", "1"] : [];
  const renderServiceLimits = resolveRestrictPageNetwork()
    ? ["-protocol_whitelist", "https,tls,tcp", ...selfContainedFormatArgs()]
    : mediaFormats();
  return [
    "-tls_verify",
    "1",
    "-ca_file",
    caFile,
    ...RECONNECT_ARGS,
    ...networkRetry,
    ...renderServiceLimits,
  ];
}

/** A signed URL grants access until it expires: strip query strings from every string field of an error and its causes. */
export function redactUrlQueriesInError<T>(error: T): T {
  if (!(error instanceof Error)) return error;
  const fields = error as unknown as Record<string, unknown>;
  for (const key of ["message", "stack", ...Object.keys(error)]) {
    if (typeof fields[key] === "string") fields[key] = redactUrlQueryStrings(fields[key]);
  }
  if (error.cause !== error) redactUrlQueriesInError(error.cause);
  return error;
}
