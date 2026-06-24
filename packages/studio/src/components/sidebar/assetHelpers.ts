import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, FONT_EXT } from "../../utils/mediaTypes";

export type MediaCategory = "audio" | "images" | "video" | "fonts";

export function getCategory(path: string): MediaCategory | null {
  if (AUDIO_EXT.test(path)) return "audio";
  if (IMAGE_EXT.test(path)) return "images";
  if (VIDEO_EXT.test(path)) return "video";
  if (FONT_EXT.test(path)) return "fonts";
  return null;
}

export function getAudioSubtype(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes("/bgm/") || lower.includes("/music/")) return "BGM";
  if (lower.includes("/sfx/") || lower.includes("/sound")) return "SFX";
  if (lower.includes("/voice/") || lower.includes("/narrat")) return "Voice";
  return "Audio";
}

export function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function ext(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
}

export const CATEGORY_LABELS: Record<MediaCategory, string> = {
  audio: "Audio",
  images: "Images",
  video: "Video",
  fonts: "Fonts",
};

export const FILTER_ORDER: MediaCategory[] = ["audio", "images", "video", "fonts"];
