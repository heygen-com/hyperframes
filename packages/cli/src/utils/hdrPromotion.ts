import {
  extractMediaMetadata,
  findHdrAutoPromotion,
  resolveProjectRelativeSrc,
  type HdrAutoPromotion,
} from "@hyperframes/engine";
import type { ProjectDir } from "./project.js";
import { loadProducer } from "./producer.js";

type ExtractMetadata = typeof extractMediaMetadata;
type MediaSource = { src: string };
type RenderMedia = { videos: readonly MediaSource[]; images: readonly MediaSource[] };

interface InspectHdrAutoPromotionDependencies {
  bundleHtml(projectDir: string): Promise<string>;
  collectMedia(html: string): RenderMedia | Promise<RenderMedia>;
}

async function bundleProjectHtml(projectDir: string): Promise<string> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  return bundleToSingleHtml(projectDir);
}

async function collectBundledRenderMedia(html: string): Promise<RenderMedia> {
  const producer = (await loadProducer()) as {
    collectRenderMedia?: (source: string) => RenderMedia;
  };
  if (!producer.collectRenderMedia) throw new Error("Render media collector unavailable");
  return producer.collectRenderMedia(html);
}

const DEFAULT_DEPENDENCIES: InspectHdrAutoPromotionDependencies = {
  bundleHtml: bundleProjectHtml,
  collectMedia: collectBundledRenderMedia,
};

export async function inspectHdrAutoPromotion(
  project: ProjectDir,
  extractMetadata: ExtractMetadata = extractMediaMetadata,
  dependencies: InspectHdrAutoPromotionDependencies = DEFAULT_DEPENDENCIES,
): Promise<HdrAutoPromotion | null> {
  const assets: Array<{
    asset: string;
    colorSpace: Awaited<ReturnType<typeof extractMediaMetadata>>["colorSpace"];
  }> = [];
  const media = await dependencies.collectMedia(await dependencies.bundleHtml(project.dir));
  for (const { src } of [...media.videos, ...media.images]) {
    const path = /^https?:\/\//i.test(src)
      ? src
      : resolveProjectRelativeSrc(src, project.dir, project.dir);
    try {
      assets.push({
        asset: src,
        colorSpace: (await extractMetadata(path)).colorSpace,
      });
    } catch {
      continue;
    }
  }
  return findHdrAutoPromotion(assets);
}
