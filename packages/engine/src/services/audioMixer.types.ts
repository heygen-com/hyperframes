export interface AudioElement {
  id: string;
  src: string;
  start: number;
  end: number;
  mediaStart: number;
  layer: number;
  volume?: number;
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
}

export interface MixResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  tracksProcessed: number;
  error?: string;
}
