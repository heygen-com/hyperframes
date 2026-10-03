import { existsSync } from "node:fs";
import { extname } from "node:path";
import {
  cropPackOutputPath,
  outputSizeForCrop,
  pixelRect,
  type PixelRect,
  type SafeFrame,
} from "@hyperframes/parsers/safe-frames";
import { extractVideoMetadata } from "./ffprobe.js";
import { isHdrColorSpace } from "./hdr.js";
import { formatFfmpegError, runFfmpeg } from "./runFfmpeg.js";
import { appendRenderProvenanceArgs } from "./renderProvenance.js";

export interface CropPackMemberPlan {
  id: string;
  crop: PixelRect;
  outputWidth: number;
  outputHeight: number;
  outputPath: string;
}

export interface CropPackMemberResult {
  id: string;
  outputPath: string;
  width: number;
  height: number;
}

export interface BuildCropPackArgsInput {
  masterPath: string;
  outputPath: string;
  crop: PixelRect;
  outputWidth: number;
  outputHeight: number;
  copyAudio: boolean;
}

export function planCropPackMembers(
  frames: SafeFrame[],
  compositionWidth: number,
  compositionHeight: number,
  masterPath: string,
): CropPackMemberPlan[] {
  return frames.map((frame) => {
    const crop = pixelRect(frame, compositionWidth, compositionHeight);
    const output = outputSizeForCrop(crop, frame.ratio);
    return {
      id: frame.id,
      crop,
      outputWidth: output.width,
      outputHeight: output.height,
      outputPath: cropPackOutputPath(masterPath, frame.id),
    };
  });
}

function videoEncodeArgs(outputPath: string): string[] {
  const ext = extname(outputPath).toLowerCase();
  if (ext === ".webm") return ["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p"];
  if (ext === ".mov") return ["-c:v", "prores_ks", "-pix_fmt", "yuva444p10le"];
  return ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
}

/**
 * ffmpeg argv for one crop-pack member. Video is crop+scale (re-encode);
 * audio is copied when requested. Provenance is re-applied; chapter
 * metadata is copied with `-map_metadata 0`. Never passes
 * `-avoid_negative_ts make_zero`.
 */
export function buildCropPackArgs(input: BuildCropPackArgsInput): string[] {
  const filter = `crop=${input.crop.width}:${input.crop.height}:${input.crop.x}:${input.crop.y},scale=${input.outputWidth}:${input.outputHeight}`;
  const args = ["-i", input.masterPath, "-filter:v", filter, ...videoEncodeArgs(input.outputPath)];
  args.push("-map", "0:v:0");
  if (input.copyAudio) {
    args.push("-map", "0:a?", "-c:a", "copy");
  } else {
    args.push("-an");
  }
  args.push("-map_metadata", "0");
  appendRenderProvenanceArgs(args, input.outputPath);
  args.push("-y", input.outputPath);
  return args;
}

export async function encodeCropPackMember(
  member: CropPackMemberPlan,
  masterPath: string,
  options: { copyAudio?: boolean; signal?: AbortSignal } = {},
): Promise<CropPackMemberResult> {
  if (!existsSync(masterPath)) {
    throw new Error(`Crop pack master "${masterPath}" does not exist.`);
  }
  const metadata = await extractVideoMetadata(masterPath);
  if (isHdrColorSpace(metadata.colorSpace)) {
    throw new Error(
      `Crop pack member "${member.id}" cannot be written: crop+scale would break HDR.`,
    );
  }
  const copyAudio = (options.copyAudio ?? true) && metadata.hasAudio;
  const args = buildCropPackArgs({
    masterPath,
    outputPath: member.outputPath,
    crop: member.crop,
    outputWidth: member.outputWidth,
    outputHeight: member.outputHeight,
    copyAudio,
  });
  const result = await runFfmpeg(args, { signal: options.signal });
  if (!result.success) {
    throw new Error(
      `Crop pack member "${member.id}" failed: ${formatFfmpegError(result.exitCode, result.stderr)}`,
    );
  }
  return {
    id: member.id,
    outputPath: member.outputPath,
    width: member.outputWidth,
    height: member.outputHeight,
  };
}

export { cropPackOutputPath };
