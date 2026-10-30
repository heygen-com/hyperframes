import {
  resolveProjectRelativeSrc,
  type AudioElement,
  type VideoElement,
} from "@hyperframes/engine";
import { loadProducer } from "./producer.js";

/** The render's own media list for a project: what it extracts, probes and mixes. */
export interface ProjectMedia {
  videos: readonly Pick<VideoElement, "src" | "hasAudio">[];
  images: readonly { src: string }[];
  audios: readonly AudioElement[];
  /** The bundled document the lists were read from. */
  html: string;
}

export async function collectProjectMedia(projectDir: string): Promise<ProjectMedia> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const html = await bundleToSingleHtml(projectDir);
  const producer = (await loadProducer()) as {
    collectRenderMedia?: (source: string) => Omit<ProjectMedia, "html">;
  };
  if (!producer.collectRenderMedia) throw new Error("Render media collector unavailable");
  return { ...producer.collectRenderMedia(html), html };
}

/** The path the render reads a media `src` from: remote URLs as they are, local ones resolved like render. */
export function mediaPath(src: string, projectDir: string): string {
  return /^https?:\/\//i.test(src) ? src : resolveProjectRelativeSrc(src, projectDir, projectDir);
}
