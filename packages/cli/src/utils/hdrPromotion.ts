import {
  extractMediaMetadata,
  findHdrAutoPromotion,
  type HdrAutoPromotion,
} from "@hyperframes/engine";
import type { ProjectDir } from "./project.js";
import { mediaPath, type ProjectMedia } from "./projectMedia.js";

type ExtractMetadata = typeof extractMediaMetadata;

export async function inspectHdrAutoPromotion(
  project: ProjectDir,
  media: Pick<ProjectMedia, "videos" | "images">,
  extractMetadata: ExtractMetadata = extractMediaMetadata,
): Promise<HdrAutoPromotion | null> {
  const assets: Array<{
    asset: string;
    colorSpace: Awaited<ReturnType<typeof extractMediaMetadata>>["colorSpace"];
  }> = [];
  for (const { src } of [...media.videos, ...media.images]) {
    try {
      assets.push({
        asset: src,
        colorSpace: (await extractMetadata(mediaPath(src, project.dir))).colorSpace,
      });
    } catch {
      continue;
    }
  }
  return findHdrAutoPromotion(assets);
}
