export interface AudioVolumeKeyframe {
  time: number;
  volume: number;
}

export interface AudioElement {
  id: string;
  src: string;
  start: number;
  end: number;
  mediaStart: number;
  layer: number;
  volume?: number;
  volumeKeyframes?: AudioVolumeKeyframe[];
  type: "audio" | "video";
}

export interface AudioTrack {
  id: string;
  srcPath: string;
  start: number;
  end: number;
  mediaStart: number;
  duration: number;
  volume: number;
  volumeKeyframes?: AudioVolumeKeyframe[];
}

export interface MixResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  tracksProcessed: number;
  error?: string;
}
