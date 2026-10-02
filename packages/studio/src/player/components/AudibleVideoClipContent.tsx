import type { ReactNode } from "react";

/** Share of the clip height the sound strip takes under a video's thumbnails. */
const AUDIBLE_VIDEO_WAVE_SHARE = 0.38;

/** A video that carries sound: thumbnails on top, its waveform strip along the bottom. */
export function AudibleVideoClipContent({
  thumbnail,
  waveform,
}: {
  thumbnail: ReactNode;
  waveform: ReactNode;
}) {
  const waveHeight = `${AUDIBLE_VIDEO_WAVE_SHARE * 100}%`;
  return (
    <div className="relative h-full w-full" data-testid="audible-video-clip">
      <div className="absolute inset-x-0 top-0" style={{ bottom: waveHeight }}>
        {thumbnail}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 bg-black/30"
        data-testid="audible-video-wave"
        style={{ height: waveHeight }}
      >
        {waveform}
      </div>
    </div>
  );
}
