import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure } from "../../measure/command.js";
import { Fix } from "../../measure/media.js";
import {
  GENERATE_TYPES,
  checkRequest,
  generate,
  parseMask,
  type GenerateRequest,
  type GenerateType,
} from "../../heygen/generate.js";
import { checkLimit, creditsOf, priceOf } from "../../heygen/pricing.js";

export const examples: Example[] = [
  [
    "Price a clean plate of a frame, then make it",
    'hyperframes media-use generate --type image --reference f120.png --prompt "the same shot with no text" --out assets/plate.png --plan',
  ],
  [
    "A 6 s shot that starts from the original's first frame",
    'hyperframes media-use generate --type video --first-frame assets/s03-first.png --prompt "slow push in" --seconds 6 --out assets/s03.mp4',
  ],
  [
    "The original's presenter re-shot clean, saying an 8 s stretch of the original voice",
    'hyperframes media-use generate --type video --reference assets/presenter-clean.png --audio assets/s02-voice.m4a --motion assets/s02-original.mp4 --mask 110,615,390,165 --prompt "the woman talks to camera, seated, soft daylight" --seconds 8 --aspect 9:16 --out assets/s02-presenter.mp4',
  ],
  [
    "The person in a photo saying a script in a chosen voice",
    'hyperframes media-use generate --type avatar --photo assets/presenter.png --script "Hi, I am Ana" --voice <voice-id> --out assets/ana.mp4',
  ],
];

const isType = (v: string): v is GenerateType => GENERATE_TYPES.some((t) => t === v);

/** Every value of a flag given more than once (citty keeps only the last). */
export function repeated(raw: string[], flag: string): string[] {
  return raw.flatMap((a, i) =>
    a === flag && raw[i + 1] !== undefined
      ? [raw[i + 1]!]
      : a.startsWith(`${flag}=`)
        ? [a.slice(flag.length + 1)]
        : [],
  );
}

export default defineCommand({
  meta: {
    name: "generate",
    description:
      "Make new media on HeyGen: an image (edited from references), a video shot (from a first frame), a person speaking from a photo, a voice, or music. --plan prices it first",
  },
  args: {
    type: {
      type: "string",
      description: `What to make: ${GENERATE_TYPES.join(", ")}`,
      required: true,
    },
    out: {
      type: "string",
      description: "The project file to write, e.g. assets/plate.png",
      required: true,
    },
    prompt: { type: "string", description: "What it shows or sounds like (image, video, music)" },
    reference: {
      type: "string",
      description:
        "image: comma-separated pictures to edit from or follow; video: the person to show speaking",
    },
    audio: {
      type: "string",
      description: "video: speech the referenced person says, lips in sync (5–15 s)",
    },
    motion: {
      type: "string",
      description: "video: a clip whose camera and body motion the shot follows (up to 15 s)",
    },
    mask: {
      type: "string",
      description:
        "video: x,y,w,h[,a-b] of the --motion clip to blank before sending (its drawn text; a-b in the clip's seconds); repeat for more",
    },
    "first-frame": { type: "string", description: "video: the picture the shot starts from" },
    photo: { type: "string", description: "avatar: the person's photo" },
    script: { type: "string", description: "avatar, voice: the words spoken" },
    voice: { type: "string", description: "avatar, voice: a HeyGen voice id" },
    seconds: {
      type: "string",
      description: "video 5–15 (default 5); music: 30, 60, 120 or 180 (default 30)",
    },
    aspect: {
      type: "string",
      description: "Aspect ratio, e.g. 9:16 (image, video without a first frame, avatar)",
    },
    model: { type: "string", description: "image: nano-banana-2 (default) or gpt-image-2.5" },
    bpm: { type: "string", description: "music: tempo, 60–180" },
    vocals: {
      type: "boolean",
      description: "music: allow singing (default instrumental)",
      default: false,
    },
    "max-credits": {
      type: "string",
      description:
        "The person's credit limit, less what earlier calls used: make nothing when this call would cost more",
    },
    plan: {
      type: "boolean",
      description: "Print the price and what would be sent; make nothing",
      default: false,
    },
    json: jsonArg,
  },
  async run({ args, rawArgs }) {
    await runMeasure(async () => {
      const type = String(args.type);
      if (!isType(type))
        throw new Fix(`unknown --type ${type}`, `--type ${GENERATE_TYPES.join("|")}`);
      const request: GenerateRequest = {
        type,
        out: String(args.out),
        prompt: args.prompt,
        references: args.reference
          ?.split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        firstFrame: args["first-frame"],
        audio: args.audio,
        motion: args.motion,
        masks: repeated(rawArgs, "--mask").map(parseMask),
        photo: args.photo,
        script: args.script,
        voice: args.voice,
        seconds: num(args.seconds, "--seconds"),
        aspect: args.aspect,
        model: args.model,
        bpm: num(args.bpm, "--bpm"),
        instrumental: !args.vocals,
      };
      const price = priceOf(request);
      const credits = creditsOf(price);
      if (args.plan) {
        checkRequest(request);
        return {
          plan: true,
          type,
          out: request.out,
          price,
          credits,
          next: "run the same command without --plan to make it",
        };
      }
      checkLimit(credits, num(args["max-credits"], "--max-credits"));
      const made = await generate(
        request,
        (status) => console.error(`generate: ${status}…`),
        credits ?? undefined,
      );
      return { ...made, price, credits };
    });
  },
});
