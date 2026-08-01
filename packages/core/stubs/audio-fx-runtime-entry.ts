/**
 * Entry point for the injectable audio-FX runtime.
 *
 * The engine renders audio by running the *same* Web Audio graph the studio
 * previews with, inside an OfflineAudioContext in the headless browser it
 * already drives. Bundling the graph builders into one IIFE is what lets both
 * ends share a single implementation rather than two that have to be kept in
 * agreement.
 *
 * Exposes `window.__HF_AUDIO_FX.render(pcm, sampleRate, chain)`, which returns
 * the processed samples.
 */

import {
  buildFxChain,
  chainNeedsWorklets,
  ensureAudioFxWorklets,
} from "../src/audio/audioFxGraph.js";
import { parseAudioFxChain, type HfAudioFxChain } from "../src/audioFx.js";

declare global {
  interface Window {
    __HF_AUDIO_FX?: {
      render(pcm: Float32Array, sampleRate: number, chainJson: string): Promise<Float32Array>;
    };
  }
}

async function render(
  pcm: Float32Array,
  sampleRate: number,
  chainJson: string,
): Promise<Float32Array> {
  const chain: HfAudioFxChain = parseAudioFxChain(chainJson);

  // Effects with a tail (reverb, delay) keep producing after the input ends.
  // Render past the source so the tail is captured rather than cut at the
  // last input sample; the caller trims back to the clip length it wants.
  const ctx = new OfflineAudioContext(1, pcm.length, sampleRate);

  if (chainNeedsWorklets(chain)) await ensureAudioFxWorklets(ctx);

  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.getChannelData(0).set(pcm);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const fx = buildFxChain(ctx, chain);
  source.connect(fx.input);
  fx.output.connect(ctx.destination);
  source.start();

  const rendered = await ctx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

window.__HF_AUDIO_FX = { render };
