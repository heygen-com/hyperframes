// media-input.mjs — ffmpeg input that reads one local media file and opens nothing that file names.
import "../../../scripts/lib/windows-exe-search.mjs";
import { spawnSync } from "node:child_process";

// Formats whose file is a list, playlist or script naming other media or programs, which ffmpeg would then
// open. A media input must be the media itself, so these are refused.
const INDIRECT_FORMATS = new Set([
  "hls",
  "applehttp",
  "concat",
  "dash",
  "webm_dash_manifest",
  "imf",
  "sdp",
  "rtp",
  "rtsp",
  "ffmetadata",
  "image2",
  "avisynth",
  "vapoursynth",
]);

// Opening a file runs its reader, and a script reader (avisynth, vapoursynth) runs the script, so even the
// probe names the readers it may use: audio and video containers that hold their own media.
export const SELF_CONTAINED_FORMATS =
  "mov,matroska,mxf,avi,mpeg,mpegts,mpegvideo,flv,asf,ogg,wav,mp3,aac,flac,aiff";
const PROBE_INPUT = ["-protocol_whitelist", "file", "-format_whitelist", SELF_CONTAINED_FORMATS];

// The demuxer name for src, such as "mp3" or "mov,mp4,m4a,3gp,3g2,mj2"; null when it cannot tell. Some
// Windows installs ship ffmpeg without ffprobe, so ffmpeg's input banner is the fallback.
export function probeFormat(src) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", ...PROBE_INPUT, "-show_entries", "format=format_name"].concat([
      "-of",
      "default=nw=1:nk=1",
      "--",
      src,
    ]),
    { encoding: "utf8" },
  );
  if (r.error?.code === "ENOENT") {
    const banner = spawnSync("ffmpeg", ["-hide_banner", ...PROBE_INPUT, "-i", src], {
      encoding: "utf8",
    });
    return /^Input #0, (.+?), from /m.exec(banner.stderr ?? "")?.[1] ?? null;
  }
  const name = r.status === 0 ? String(r.stdout).trim() : "";
  return name || null;
}

/** True when a probed format is a list, playlist or script that names other files. */
export const isIndirectFormat = (format) =>
  format.split(",").some((name) => INDIRECT_FORMATS.has(name));

/** ffmpeg input arguments pinned to the probed format and the file protocol: only `src` is opened. */
export const pinnedInput = (format, src) => [
  "-format_whitelist",
  format,
  "-protocol_whitelist",
  "file",
  "-i",
  src,
];
