export interface StereoLevel {
  l: number;
  r: number;
}

export interface LevelTap {
  /** Peak of the last analyser window per channel, linear 0..1+. */
  read(): StereoLevel;
  dispose(): void;
}

const WINDOW = 2048;

function peak(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i] ?? 0));
  return max;
}

/** A side branch off `source`; the explicit-stereo gain up-mixes mono to both channels. */
export function createLevelTap(ctx: BaseAudioContext, source: AudioNode): LevelTap {
  const mix = ctx.createGain();
  mix.channelCount = 2;
  mix.channelCountMode = "explicit";
  const splitter = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser();
  const right = ctx.createAnalyser();
  left.fftSize = right.fftSize = WINDOW;
  source.connect(mix);
  mix.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  const bufL = new Float32Array(new ArrayBuffer(WINDOW * 4));
  const bufR = new Float32Array(new ArrayBuffer(WINDOW * 4));
  return {
    read: () => ({ l: peak(left, bufL), r: peak(right, bufR) }),
    dispose: () => {
      try {
        source.disconnect(mix);
        mix.disconnect();
        splitter.disconnect();
      } catch {
        // Source already torn down.
      }
    },
  };
}
