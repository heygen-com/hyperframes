// @vitest-environment happy-dom

import { afterEach, expect, it } from "vitest";
import { sealedPreviewFrame } from "../lib/sealedPreviewFrame.test-helpers";
import { previewStillLoading } from "./Player";

afterEach(() => {
  document.body.innerHTML = "";
});

function bufferingAudio(): HTMLAudioElement {
  const audio = document.createElement("audio");
  Object.defineProperty(audio, "readyState", { value: 0, configurable: true });
  Object.defineProperty(audio, "networkState", { value: 2, configurable: true });
  document.body.append(audio);
  return audio;
}

// fails without the fix: a sealed frame's document could not be read, so its buffering media counted as loaded.
it("keeps a sealed preview loading while its media still buffers", async () => {
  bufferingAudio();

  expect(await previewStillLoading(sealedPreviewFrame().iframe, false)).toBe(true);
});

it("lets a sealed preview go once its media can play through", async () => {
  const audio = bufferingAudio();
  Object.defineProperty(audio, "readyState", { value: 4, configurable: true });

  expect(await previewStillLoading(sealedPreviewFrame().iframe, true)).toBe(false);
});
