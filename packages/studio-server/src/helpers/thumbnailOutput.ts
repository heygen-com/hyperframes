export interface ThumbnailOutputDimensions {
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
}

/** Sole adapter rule for capturing authored layout at bounded physical dimensions. */
export function thumbnailDeviceScaleFactor({
  width,
  height,
  outputWidth,
  outputHeight,
}: ThumbnailOutputDimensions): number {
  const dimensions = [width, height, outputWidth, outputHeight];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Thumbnail dimensions must be positive finite numbers");
  }
  return Math.min(1, outputWidth / width, outputHeight / height);
}
