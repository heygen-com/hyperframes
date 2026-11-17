// `audio-meter`: the preview's program and group level taps, for Studio's meters. `on: true` starts the
// taps when they are off and reads them; `on: false` removes them.
import type { StereoLevel } from "../levelTap";

export type AudioMeterParams = { on: boolean };
export type AudioMeterLevels = { master: StereoLevel; groups: Record<string, StereoLevel> };

export function parseAudioMeter(params: unknown): AudioMeterParams | null {
  if (Object.prototype.toString.call(params) !== "[object Object]") return null;
  const { on, ...rest } = params as Record<string, unknown>;
  return typeof on === "boolean" && Object.keys(rest).length === 0 ? { on } : null;
}

type LevelTaps = { start(): void; stop(): void; read(): AudioMeterLevels };

/** `levels` is null while the taps are off, or when this runtime has no audio graph. */
export function audioMeter(
  { on }: AudioMeterParams,
  meter: LevelTaps | undefined,
): { levels: AudioMeterLevels | null } {
  if (!meter) return { levels: null };
  if (!on) {
    meter.stop();
    return { levels: null };
  }
  meter.start();
  return { levels: meter.read() };
}
