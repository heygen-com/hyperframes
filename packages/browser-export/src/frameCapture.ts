import { getFontEmbedCSS, toCanvas } from "html-to-image";

export interface FrameCapturer {
  canvas: HTMLCanvasElement;
  capture(): Promise<void>;
}

/**
 * Rasterizes the composition root into a persistent recording canvas via
 * SVG foreignObject (html-to-image). The same canvas instance is handed to
 * mediabunny's CanvasSource, which snapshots it on every add().
 */
export async function createFrameCapturer(
  root: HTMLElement,
  width: number,
  height: number,
  pixelRatio: number,
): Promise<FrameCapturer> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context for export");
  }
  // Fonts cannot change between frames — embed them once instead of letting
  // html-to-image re-fetch and re-serialize them on every capture.
  const fontEmbedCSS = await getFontEmbedCSS(root);
  const capture = async (): Promise<void> => {
    const frame = await toCanvas(root, {
      width,
      height,
      pixelRatio,
      fontEmbedCSS,
      cacheBust: false,
    });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);
  };
  return { canvas, capture };
}
