/**
 * Entry point for the injectable audio-FX runtime.
 *
 * The engine renders audio by running the *same* Web Audio graph the studio
 * previews with, inside an OfflineAudioContext in the headless browser it
 * already drives. Bundling the graph builders into one IIFE is what lets both
 * ends share a single implementation rather than two that have to be kept in
 * agreement.
 *
 * Exposes `window.__HF_AUDIO_FX.render(pcm, sampleRate, chain, automation)`,
 * which returns the processed samples.
 */

import {
  buildFxChain,
  chainNeedsWorklets,
  ensureAudioFxWorklets,
} from "../src/audio/audioFxGraph.js";
import { scheduleChainAutomation } from "../src/audio/audioFxAutomation.js";
import { parseAutomation, resolveAutomation } from "../src/audioAutomation.js";
import { parseAudioFxChain, type HfAudioFxChain } from "../src/audioFx.js";

declare global {
  interface Window {
    __HF_AUDIO_FX?: {
      render(
        planes: Float32Array[],
        sampleRate: number,
        chainJson: string,
        automationJson?: string,
      ): Promise<Float32Array[]>;
    };
  }
}

/**
 * Run the chain over one clip's audio, a plane per channel.
 *
 * Channel count is preserved: folding to mono here collapsed a stereo bed's
 * width for the render only, while preview kept it stereo.
 *
 * The context is exactly as long as the input. An effect with a tail — reverb,
 * delay — is still ringing at that point and is cut there, which is the one place
 * the render does not match preview. Extending it would lengthen the clip in the
 * mix, so how far a tail may run past a clip's end is a product decision rather
 * than something to pick here.
 */

/** The clip's audio as an AudioBuffer, a plane per channel. */
function toBuffer(
  ctx: OfflineAudioContext,
  planes: readonly Float32Array[],
  channels: number,
  frames: number,
  sampleRate: number,
): AudioBuffer {
  const buffer = ctx.createBuffer(channels, frames, sampleRate);
  for (let c = 0; c < channels; c++) {
    const plane = planes[c];
    if (plane) buffer.getChannelData(c).set(plane);
  }
  return buffer;
}

/** Every rendered channel, copied out of the result buffer. */
function toPlanes(rendered: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    out.push(new Float32Array(rendered.getChannelData(c)));
  }
  return out;
}

async function render(
  planes: Float32Array[],
  sampleRate: number,
  chainJson: string,
  automationJson?: string,
): Promise<Float32Array[]> {
  const chain: HfAudioFxChain = parseAudioFxChain(chainJson);
  const channels = Math.max(1, planes.length);
  const frames = planes[0]?.length ?? 0;
  const ctx = new OfflineAudioContext(channels, frames, sampleRate);

  if (chainNeedsWorklets(chain)) await ensureAudioFxWorklets(ctx);

  const source = ctx.createBufferSource();
  source.buffer = toBuffer(ctx, planes, channels, frames, sampleRate);

  const fx = buildFxChain(ctx, chain);

  // The input WAV is the clip's own audio from its first sample, so clip-local
  // time is offline time — the envelope needs no offset here. Same scheduler as
  // preview, which is what makes the two agree.
  if (automationJson) {
    const automation = resolveAutomation(parseAutomation(automationJson), chain);
    scheduleChainAutomation(automation, chain, fx.nodes, {
      scheduledAt: 0,
      elapsed: 0,
      rate: 1,
    });
  }

  source.connect(fx.input);
  fx.output.connect(ctx.destination);
  source.start();

  return toPlanes(await ctx.startRendering());
}

window.__HF_AUDIO_FX = { render };
