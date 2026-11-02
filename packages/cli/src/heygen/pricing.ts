// Prices before a paid call, from the HyperFrames app's creation pricing. HeyGen charges in units of $1/60, rounded
// up; the label rounds up to the cent. Routes HeyGen does not price ahead say so instead of guessing.
import { Fix, probeSeconds, probeVideo, round } from "../measure/media.js";
import { GUIDE_MAX_S, type GenerateRequest } from "./generate.js";

export interface Price {
  usd: number | null;
  /** The list price before HeyGen's unit rounding. */
  list: number | null;
  /** What a HyperFrames plan charges, before rounding up to a whole credit. */
  credits: number | null;
  basis: string;
}

const UNIT = 1 / 60;
const charged = (usd: number) => Math.ceil(usd / UNIT - 1e-9) * UNIT;
const cents = (usd: number) => Math.ceil(charged(usd) * 100 - 1e-9) / 100;
const HF_CREDITS_PER_USD = 1000;
const at = (list: number, basis: string, credits = list * HF_CREDITS_PER_USD): Price => ({
  usd: cents(list),
  list,
  credits,
  basis,
});

const GPT_IMAGE: Record<string, number> = {
  "1:1": 0.05268,
  "16:9": 0.0396,
  "9:16": 0.0396,
  "4:3": 0.03612,
  "3:4": 0.03612,
};
const NANO_IMAGE = 0.067;
const VIDEO_768P_PER_S = 0.018;
// A reference shot (pictures, voice or guide clip) bills more, and its guide clip's seconds bill too: measured
// 2026-10-23 from the wallet, 5 s with a picture $0.25, 10 s $0.50, 5 s with a 1 s guide $0.30, with a 3 s guide $0.40.
const VIDEO_REF_768P_PER_S = 0.05;
// A reference shot's first two pictures are included; each one after them bills on its own line.
const VIDEO_INCLUDED_IMAGES = 2;
const VIDEO_EXTRA_IMAGE = 0.02;
// The price book's HyperFrames rows (experiment-framework price_book rules.json, 2026-10-30).
const HF_VIDEO_768P_PER_S = 18;
const HF_VIDEO_REF_768P_PER_S = 50;
const HF_VIDEO_EXTRA_IMAGE = 20;
const HF_AVATAR_IV_PHOTO_PER_S = 1155 / 60;
const HF_AVATAR_IV_TWIN_PER_S = 2415 / 60;
// Billed on the whole video, not the voice: measured 2026-11-01, a 13.75 s shot took 97 credits.
const HF_LIPSYNC_SPEED_PER_S = 7;
const MUSIC_PER_TRACK = 0.08;
const AVATAR_IV_PER_MIN = 4.83;
const SCRIPT_WORDS_PER_S = 2;
const HF_TTS_PER_S = 1;
const SPEECH_CHARS_PER_S = { zh: 5, en: 15 };

// fallow-ignore-next-line complexity
export function priceOf(r: GenerateRequest): Price {
  switch (r.type) {
    case "image": {
      const refs = r.references?.length ?? 0;
      if ((r.model ?? "nano-banana-2") === "nano-banana-2")
        return at(NANO_IMAGE, "nano-banana-2, $0.067 an image");
      const each = GPT_IMAGE[r.aspect ?? "16:9"] ?? GPT_IMAGE["16:9"]!;
      return at(
        each + Math.max(0, refs - 1) * 0.0082,
        `gpt-image-2.5 at ${r.aspect ?? "16:9"}, $0.0082 a reference after the first`,
      );
    }
    case "video": {
      const seconds = Math.min(15, Math.max(5, Math.round(r.seconds ?? 5)));
      if (r.audio || r.references?.length || r.motion) {
        const guide = r.motion ? Math.min(GUIDE_MAX_S, probeVideo(r.motion).pictureDuration) : 0;
        const extra = Math.max(0, (r.references?.length ?? 0) - VIDEO_INCLUDED_IMAGES);
        const billed = seconds + guide;
        return at(
          billed * VIDEO_REF_768P_PER_S + extra * VIDEO_EXTRA_IMAGE,
          `heygen-video-1 reference shot at 768p, ${seconds} s${guide ? ` and the ${round(guide, 2)} s guide` : ""} at $0.05 a second${extra ? `, ${extra} extra pictures at $0.02` : ""}`,
          billed * HF_VIDEO_REF_768P_PER_S + extra * HF_VIDEO_EXTRA_IMAGE,
        );
      }
      return at(
        seconds * VIDEO_768P_PER_S,
        `heygen-video-1 at 768p, ${seconds} s at $0.018 a second`,
        seconds * HF_VIDEO_768P_PER_S,
      );
    }
    case "lipsync": {
      const seconds = r.video ? probeVideo(r.video).pictureDuration : 0;
      return {
        usd: null,
        list: null,
        credits: seconds * HF_LIPSYNC_SPEED_PER_S,
        basis: `lipsync at speed, ${round(seconds, 2)} s at ${HF_LIPSYNC_SPEED_PER_S} credits a second`,
      };
    }
    case "avatar": {
      const words = (r.script ?? "").split(/\s+/).filter(Boolean).length;
      const seconds = r.audio
        ? probeSeconds(r.audio)
        : Math.max(1, Math.floor(words / SCRIPT_WORDS_PER_S));
      return at(
        Math.ceil(seconds * AVATAR_IV_PER_MIN) / 60,
        `avatar video, about ${round(seconds, 1)} s${r.audio ? "" : ` from ${words} words`} at $4.83 a minute`,
        seconds * (r.avatar ? HF_AVATAR_IV_TWIN_PER_S : HF_AVATAR_IV_PHOTO_PER_S),
      );
    }
    case "music":
      return at(MUSIC_PER_TRACK, "lyria-3-pro, $0.08 a track");
    case "voice": {
      const text = r.script ?? "";
      const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length;
      const seconds = cjk / SPEECH_CHARS_PER_S.zh + (text.length - cjk) / SPEECH_CHARS_PER_S.en;
      return {
        usd: null,
        list: null,
        credits: seconds * HF_TTS_PER_S,
        basis: `about ${round(seconds, 1)} s of speech at ${HF_TTS_PER_S} credit a second, an estimate: it is charged per character`,
      };
    }
  }
}

// No HeyGen unit rounding here: a $0.067 image is charged 67 credits, measured on dev 2026-10-29. Still an estimate.
export const creditsOf = (p: Price): number | null =>
  p.credits === null ? null : Math.ceil(p.credits - 1e-9);

/** Refuses, before anything is sent, a call that would not fit what is left of the person's credit limit. */
export function checkLimit(credits: number | null, limit: number | undefined): void {
  if (limit === undefined) return;
  const fix =
    "tell the person what their limit leaves out, then ask whether to raise it or make the video without this piece";
  if (credits === null)
    throw new Fix(
      `this call cannot be priced ahead, so it cannot be kept under --max-credits ${limit}; nothing was made`,
      fix,
    );
  if (credits > limit)
    throw new Fix(
      `this call is about ${credits} credits, over --max-credits ${limit}; nothing was made or charged`,
      fix,
    );
}
