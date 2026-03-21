export interface EncoderOptions {
  fps: number;
  width: number;
  height: number;
  codec?: "h264" | "h265" | "vp9" | "prores";
  preset?: string;
  quality?: number;
  bitrate?: string;
  pixelFormat?: string;
  useGpu?: boolean;
}

export interface EncodeResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  framesEncoded: number;
  fileSize: number;
  error?: string;
}

export interface MuxResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
}
