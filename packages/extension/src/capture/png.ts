import { planVisibleCrop, type CropPlan } from "./geometry";
import type { SelectionRect } from "../protocol";

export interface CroppedPng {
  mime: "image/png";
  bytes: Uint8Array;
  dataUrl: string;
  width: number;
  height: number;
  completeness: CropPlan["completeness"];
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export async function cropVisiblePng(
  screenshotDataUrl: string,
  selection: SelectionRect,
  signal: AbortSignal,
): Promise<CroppedPng | null> {
  signal.throwIfAborted();
  const screenshot = await (await fetch(screenshotDataUrl)).blob();
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(screenshot);
  try {
    const plan = planVisibleCrop(selection, bitmap.width, bitmap.height);
    if (!plan) return null;
    const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create a 2D crop surface.");
    context.drawImage(
      bitmap,
      plan.sourceX,
      plan.sourceY,
      plan.sourceWidth,
      plan.sourceHeight,
      0,
      0,
      plan.outputWidth,
      plan.outputHeight,
    );
    const blob = await canvas.convertToBlob({ type: "image/png" });
    signal.throwIfAborted();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      mime: "image/png",
      bytes,
      dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}`,
      width: plan.outputWidth,
      height: plan.outputHeight,
      completeness: plan.completeness,
    };
  } finally {
    bitmap.close();
  }
}

export async function compressOpaqueCrop(
  crop: CroppedPng,
  signal: AbortSignal,
): Promise<Omit<CroppedPng, "mime"> & { mime: "image/webp" }> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(
    new Blob([crop.bytes.slice().buffer], { type: crop.mime }),
  );
  try {
    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create an opaque-island surface.");
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.88 });
    signal.throwIfAborted();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      mime: "image/webp",
      bytes,
      dataUrl: `data:image/webp;base64,${bytesToBase64(bytes)}`,
      width: crop.width,
      height: crop.height,
      completeness: crop.completeness,
    };
  } finally {
    bitmap.close();
  }
}
