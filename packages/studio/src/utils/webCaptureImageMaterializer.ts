import type {
  WebCaptureResourceInspection,
  WebCaptureResourceMaterializer,
} from "@hyperframes/core/web-capture";

interface DecodedWebCaptureImage {
  width: number;
  height: number;
  close: () => void;
}

export type WebCaptureImageDecoder = (
  blob: Blob,
  signal: AbortSignal,
) => Promise<DecodedWebCaptureImage>;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Image materialization aborted", "AbortError");
}

const decodeBrowserImage: WebCaptureImageDecoder = async (blob, signal) => {
  if (signal.aborted) throw abortReason(signal);
  const bitmap = await createImageBitmap(blob);
  if (signal.aborted) {
    bitmap.close();
    throw abortReason(signal);
  }
  return bitmap;
};

function isWebCaptureImageMime(
  mime: WebCaptureResourceInspection["mime"],
): mime is "image/png" | "image/jpeg" | "image/webp" {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";
}

export function createWebCaptureImageMaterializer(
  decodeImage: WebCaptureImageDecoder = decodeBrowserImage,
): WebCaptureResourceMaterializer {
  return async (bytes, inspected, signal) => {
    if (inspected.mime === "model/gltf-binary") return inspected;
    if (!isWebCaptureImageMime(inspected.mime)) return null;
    if (signal.aborted) throw abortReason(signal);

    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    const image = await decodeImage(
      new Blob([ownedBytes.buffer], { type: inspected.mime }),
      signal,
    );
    try {
      if (signal.aborted) throw abortReason(signal);
      return { mime: inspected.mime, width: image.width, height: image.height };
    } finally {
      image.close();
    }
  };
}

export const materializeWebCaptureImageResource = createWebCaptureImageMaterializer();
