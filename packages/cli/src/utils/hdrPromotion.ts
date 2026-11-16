import {
  extractMediaMetadata,
  findHdrAutoPromotion,
  gradingKeepsSdr,
  sanitizeHdrAutoPromotionAsset,
  type HdrAutoPromotion,
} from "@hyperframes/engine";
import type { ProjectDir } from "./project.js";
import { isRemoteMediaSrc, mediaPath, type ProjectMedia } from "./projectMedia.js";

type ExtractMetadata = typeof extractMediaMetadata;

export async function inspectHdrAutoPromotion(
  project: ProjectDir,
  media: Pick<ProjectMedia, "videos" | "images">,
  extractMetadata: ExtractMetadata = extractMediaMetadata,
): Promise<HdrAutoPromotion | null> {
  if (gradingKeepsSdr("auto", media)) return null;
  const assets: Array<{
    asset: string;
    colorSpace: Awaited<ReturnType<typeof extractMediaMetadata>>["colorSpace"];
  }> = [];
  for (const { src } of [...media.videos, ...media.images]) {
    const path = mediaPath(src, project.dir);
    if (path === null) continue;
    try {
      assets.push({ asset: src, colorSpace: (await extractMetadata(path)).colorSpace });
    } catch {
      continue;
    }
  }
  return findHdrAutoPromotion(assets);
}

export function remoteMediaNotInspected(media: Pick<ProjectMedia, "videos" | "images">): string[] {
  if (gradingKeepsSdr("auto", media)) return [];
  const remote = [...media.videos, ...media.images].filter(({ src }) => isRemoteMediaSrc(src));
  return [
    ...new Set(remote.map(({ src }) => withoutCredentials(sanitizeHdrAutoPromotionAsset(src)))),
  ];
}

function withoutCredentials(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@]*@/i, "$1");
}
