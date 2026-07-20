import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeUrl } from "./freeze.mjs";
import {
  classifyHeygenErrorCode,
  HEYGEN_AUTH_COMMAND,
  HEYGEN_CLIENT_SOURCE_ARGV,
  reportHeygenFailure,
  runHeygenJson,
} from "./heygen-cli.mjs";

export const AVATAR_VIDEO_SIGNIN_MESSAGE = `media-use: avatar video is free for new API users — sign in: ${HEYGEN_AUTH_COMMAND}`;

// Cache only a truthy id -- a transient discovery failure must not poison the
// cache with `null` and permanently disable heygen.video for the rest of the
// process. `onError` lets the caller distinguish not_authenticated (and nudge
// onboarding) from any other discovery failure.
let cachedAvatarId;
function defaultAvatarId(onError) {
  if (cachedAvatarId) return cachedAvatarId;
  const j = runHeygenJson(
    "heygen",
    ["avatar", "list", "--ownership", "public", "--limit", "1"],
    "avatar list",
    onError,
  );
  cachedAvatarId = j?.data?.[0]?.avatar_id || null;
  return cachedAvatarId;
}

let cachedStarfishVoiceId;
function defaultStarfishVoiceId(onError) {
  if (cachedStarfishVoiceId) return cachedStarfishVoiceId;
  const j = runHeygenJson(
    "heygen",
    ["voice", "list", "--engine", "starfish", "--limit", "1"],
    "voice list",
    onError,
  );
  cachedStarfishVoiceId = j?.data?.[0]?.voice_id || null;
  return cachedStarfishVoiceId;
}

export async function heygenVideoGenerate(intent, ctx) {
  let discoveryFailureReason = null;
  const captureReason = (reason) => {
    discoveryFailureReason ??= reason;
  };

  // Short-circuit: once one discovery call fails, the result is null either
  // way, so don't attempt the second -- that would double-fire the onboarding
  // message and the provider-error telemetry ping for what's really one failure.
  const avatarId = ctx?.avatarId || defaultAvatarId(captureReason);
  if (!avatarId) {
    if (discoveryFailureReason === "not_authenticated") console.error(AVATAR_VIDEO_SIGNIN_MESSAGE);
    return null;
  }
  const voiceId = ctx?.voiceId || defaultStarfishVoiceId(captureReason);
  if (!voiceId) {
    if (discoveryFailureReason === "not_authenticated") console.error(AVATAR_VIDEO_SIGNIN_MESSAGE);
    return null;
  }

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
      console.error(AVATAR_VIDEO_SIGNIN_MESSAGE);
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
