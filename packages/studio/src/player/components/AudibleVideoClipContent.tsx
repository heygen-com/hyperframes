import type { ReactNode } from "react";

/** Share of the clip height the sound strip takes under a video's thumbnails: tall enough for the bars to read. */
const AUDIBLE_VIDEO_WAVE_SHARE = 0.5;

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
      {/* The audio clip's own surface, so the strip reads like an audio row in every theme. */}
      <div
        className="audible-video-wave absolute inset-x-0 bottom-0"
        data-testid="audible-video-wave"
        style={{ height: waveHeight, backgroundColor: "var(--timeline-clip-audio-bg)" }}
      >
        {waveform}
      </div>
    </div>
  );
}
