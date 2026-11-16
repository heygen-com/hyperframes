import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { redactUrlQueryStrings } from "@hyperframes/core";
import { resolveRestrictPageNetwork } from "../config.js";
import { getFfmpegBinary } from "./ffmpegBinaries.js";

// The Lambda nodejs image (Amazon Linux 2023) ships the first; Debian/Ubuntu the second; macOS the third.
const CA_BUNDLES = [
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/ssl/cert.pem",
];

// Lambda's ffprobe 4.0 accepts these but not -reconnect_on_network_error; a stalled read fails after 30 s.
const RECONNECT_ARGS = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_delay_max", "2"];

const SELF_CONTAINED_FORMATS =
  "mov,matroska,mxf,avi,mpeg,mpegts,mpegvideo,flv,asf,ogg,wav,mp3,aac,flac,aiff,gif,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe";

/**
 * Demuxers that open other files or URLs on their own, named by the bytes they are handed. Everything else
 * ffmpeg reads is allowed for composition media. hls and concat stay allowed: ffmpeg copies the format
 * whitelist into every nested open, so a list cannot reach one of these, and the playlist folder walk
 * confines the paths a list names.
 */
const PATH_OPENING_DEMUXERS = new Set([
  "dash",
  "imf",
  "mlv",
  "vobsub",
  "dvdvideo",
  "sdp",
  "rtsp",
  "rtp",
  "sap",
  "avisynth",
  "vapoursynth",
]);

let mediaDemuxers: string | undefined;

/** The `-demuxers` listing minus input devices and {@link PATH_OPENING_DEMUXERS}, as a `-format_whitelist` value. */
function demuxersFromListing(listing: string): string {
  const names = new Set<string>();
  for (const line of listing.split("\n")) {
    const row = /^ (D)[E ]([d ]) (\S+)/.exec(line);
    if (!row || row[2] === "d") continue;
    const aliases = row[3]!.split(",");
    if (aliases.some((alias) => PATH_OPENING_DEMUXERS.has(alias))) continue;
    for (const alias of aliases) names.add(alias);
  }
  return names.size > 0 ? [...names].join(",") : SELF_CONTAINED_FORMATS;
}

/** Every demuxer the installed ffmpeg reports that opens nothing by itself; the self-contained list when ffmpeg cannot be asked. */
function mediaDemuxerList(): string {
  if (mediaDemuxers !== undefined) return mediaDemuxers;
  try {
    mediaDemuxers = demuxersFromListing(
      execFileSync(getFfmpegBinary(), ["-hide_banner", "-demuxers"], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    mediaDemuxers = SELF_CONTAINED_FORMATS;
  }
  return mediaDemuxers;
}

/** Tests feed a `-demuxers` listing so none spawns ffmpeg; no argument forgets it. */
export function _setDemuxerListingForTests(listing?: string): void {
  mediaDemuxers = listing === undefined ? undefined : demuxersFromListing(listing);
}

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
  if (!/^https:\/\//i.test(input)) return ["-format_whitelist", mediaDemuxerList()];
  const caFile = caBundles.find((path) => existsSync(path));
  if (!caFile) {
    throw new Error(
      `[FFmpeg] cannot verify TLS for an https input: no CA bundle at ${caBundles.join(", ")}`,
    );
  }
  const networkRetry = tool === "ffmpeg" ? ["-reconnect_on_network_error", "1"] : [];
  const renderServiceLimits = resolveRestrictPageNetwork()
    ? ["-protocol_whitelist", "https,tls,tcp", ...selfContainedFormatArgs()]
    : ["-format_whitelist", mediaDemuxerList()];
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
