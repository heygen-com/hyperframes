import { isAudioElement } from "./domRealm";
import { readElementPlaybackRate, readElementRateSpec } from "./media";
import { isWebKit } from "./mediaClock";
import { isLongSource } from "./preloadMedia";
import type { WebAudioTransport } from "./webAudioTransport";

export { bytesOfSource } from "./preloadMedia";

/** WebKit restarts a media element's audio 150 to 400 ms late; a decoded buffer on the context clock starts on time. */
export function decodesFirst(el: HTMLMediaElement, webAudio: WebAudioTransport): boolean {
  return (
    isWebKit() &&
    isAudioElement(el) &&
    !isLongSource(el) &&
    webAudio.fitsDecodeBudget(el) &&
    typeof readElementRateSpec(el) === "number" &&
    readElementPlaybackRate(el) === 1
  );
}
