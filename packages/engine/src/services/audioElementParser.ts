import { parseHTML } from "linkedom";
import {
  multiplyVolumeKeyframeEnvelopes,
  parseVolumeKeyframesAttribute,
} from "@hyperframes/core/media-volume-envelope";
import { unwrapTemplate } from "../utils/htmlTemplate.js";
import type { AudioElement } from "./audioMixer.types.js";

function parseElementVolumeKeyframes(
  el: Element,
  start: number,
  end: number,
  baseVolume: number,
): AudioElement["volumeKeyframes"] {
  const authored = parseVolumeKeyframesAttribute(el.getAttribute("data-volume-keyframes"));
  const duck = parseVolumeKeyframesAttribute(el.getAttribute("data-hf-duck-keyframes"));
  if (duck.length === 0) return authored.length > 0 ? authored : undefined;
  return multiplyVolumeKeyframeEnvelopes({
    sourceKeyframes: authored,
    multiplierKeyframes: duck,
    trackStart: start,
    trackEnd: end,
    baseVolume,
  });
}

function readAudioElement(el: Element, type: "audio" | "video"): AudioElement | null {
  const id = el.getAttribute("id");
  const src = el.getAttribute("src");
  if (!id || !src) return null;

  const startAttr = el.getAttribute("data-start");
  const endAttr = el.getAttribute("data-end");
  const mediaStartAttr = el.getAttribute("data-media-start");
  const layerAttr = el.getAttribute("data-layer");
  const volumeAttr = el.getAttribute("data-volume");
  const start = startAttr ? parseFloat(startAttr) : 0;
  const end = endAttr ? parseFloat(endAttr) : 0;
  const volume = volumeAttr ? parseFloat(volumeAttr) : 1.0;

  return {
    id: type === "video" ? `${id}-audio` : id,
    src,
    start,
    end,
    mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
    layer: layerAttr ? parseInt(layerAttr) : 0,
    volume,
    volumeKeyframes: parseElementVolumeKeyframes(el, start, end, volume),
    type,
  };
}

export function parseAudioElements(html: string): AudioElement[] {
  const elements: AudioElement[] = [];
  const { document } = parseHTML(unwrapTemplate(html));

  for (const el of document.querySelectorAll("audio[id][src]")) {
    const audio = readAudioElement(el, "audio");
    if (audio) elements.push(audio);
  }

  for (const el of document.querySelectorAll('video[id][src][data-has-audio="true"]')) {
    const audio = readAudioElement(el, "video");
    if (audio) elements.push(audio);
  }

  return elements;
}
