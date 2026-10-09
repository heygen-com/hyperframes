import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import { ffprobeBinary } from "./ff-binaries.mjs";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac"]);

export function probe(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".svg") return { width: null, height: null, duration: null, codec: "svg" };

  const ffprobe = ffprobeBinary();
  try {
    // execFileSync (no shell) so a hostile filename like `"; rm -rf ~; ".png`
    // can't break out of the quoting — filePath is passed as a literal argv entry.
    const raw = execFileSync(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "--", filePath],
      { encoding: "utf8", timeout: 5000 },
    );
    const info = JSON.parse(raw);
    const streams = info.streams ?? [];
    const wantedType = AUDIO_EXT.has(ext) ? "audio" : "video";
    const stream =
      streams.find((s) => s.codec_type === wantedType && s.disposition?.attached_pic !== 1) ??
      streams[0];
    const format = info.format;

    const isImage = IMAGE_EXT.has(ext);
    const duration = isImage
      ? null
      : parseFloat(format?.duration) || parseFloat(stream?.duration) || null;
    const width = parseInt(stream?.width, 10) || null;
    const height = parseInt(stream?.height, 10) || null;
    const codec = stream?.codec_name || null;

    return {
      duration: duration != null ? Math.round(duration * 10) / 10 : null,
      width,
      height,
      codec,
    };
  } catch {
    return { duration: null, width: null, height: null, codec: null };
  }
}
