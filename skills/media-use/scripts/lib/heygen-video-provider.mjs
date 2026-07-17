import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeUrl } from "./freeze.mjs";
import {
  classifyHeygenErrorCode,
  HEYGEN_AUTH_COMMAND,
  HEYGEN_CLIENT_SOURCE_ARGV,
  reportHeygenFailure,
} from "./heygen-cli.mjs";

function runJson(bin, argv, label) {
  let out;
  try {
    out = execFileSync(bin, argv, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    reportHeygenFailure(err, `${bin} ${label}`);
    return null;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

let cachedAvatarId;
function defaultAvatarId() {
  if (cachedAvatarId !== undefined) return cachedAvatarId;
  const j = runJson(
    "heygen",
    ["avatar", "list", "--ownership", "public", "--limit", "1"],
    "avatar list",
  );
  cachedAvatarId = j?.data?.[0]?.avatar_id || null;
  return cachedAvatarId;
}

let cachedStarfishVoiceId;
function defaultStarfishVoiceId() {
  if (cachedStarfishVoiceId !== undefined) return cachedStarfishVoiceId;
  const j = runJson(
    "heygen",
    ["voice", "list", "--engine", "starfish", "--limit", "1"],
    "voice list",
  );
  cachedStarfishVoiceId = j?.data?.[0]?.voice_id || null;
  return cachedStarfishVoiceId;
}

export async function heygenVideoGenerate(intent, ctx) {
  const avatarId = ctx?.avatarId || defaultAvatarId();
  const voiceId = ctx?.voiceId || defaultStarfishVoiceId();
  if (!avatarId || !voiceId) return null;

  let out;
  try {
    out = execFileSync(
      "heygen",
      [
        ...HEYGEN_CLIENT_SOURCE_ARGV,
        "video",
        "create",
        "--wait",
        "-d",
        JSON.stringify({
          type: "avatar",
          avatar_id: avatarId,
          script: intent,
          voice_id: voiceId,
        }),
      ],
      {
        encoding: "utf8",
        timeout: 300000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (err) {
    if (classifyHeygenErrorCode(err) === "not_authenticated") {
      console.error(
        `media-use: avatar video is free for new API users — sign in: ${HEYGEN_AUTH_COMMAND}`,
      );
    }
    reportHeygenFailure(err, "heygen video create");
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    console.error("media-use: `heygen video create` returned invalid JSON");
    return null;
  }
  const videoUrl = parsed?.data?.video_url;
  if (typeof videoUrl !== "string" || !videoUrl) {
    console.error("media-use: `heygen video create` returned no video URL");
    return null;
  }

  const tmpPath = join(tmpdir(), `media-use-heygen-video-${process.pid}-${Date.now()}.mp4`);
  try {
    await freezeUrl(videoUrl, tmpPath);
  } catch (err) {
    console.error(`media-use: heygen video download failed: ${err.message}`);
    return null;
  }

  return {
    localPath: tmpPath,
    ext: ".mp4",
    source: "generated",
    metadata: {
      description: intent,
      provider: "heygen.video",
      provenance: { prompt: intent },
    },
  };
}
