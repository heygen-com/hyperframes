import {
  buildWebCaptureText,
  parseWebCaptureText,
  sha256Hex,
  type WebCaptureResourceInspection,
  type WebCaptureValidationOptions,
} from "@hyperframes/core/web-capture";
import type { CroppedPng } from "./png";
import type { EditableDomDraft, SelectionRect } from "../protocol";

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

async function inspectImage(
  bytes: Uint8Array,
  inspected: WebCaptureResourceInspection,
  signal: AbortSignal,
): Promise<WebCaptureResourceInspection | null> {
  signal.throwIfAborted();
  if (inspected.mime === "model/gltf-binary") return inspected;
  const bitmap = await createImageBitmap(
    new Blob([bytes.slice().buffer], { type: inspected.mime }),
  );
  try {
    return { mime: inspected.mime, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function validationOptions(signal?: AbortSignal): WebCaptureValidationOptions {
  return { materializeResource: inspectImage, signal };
}

export async function buildStillCapture(
  crop: CroppedPng,
  selection: SelectionRect,
  signal: AbortSignal,
) {
  const resourceId = "selected-still";
  return buildWebCaptureText(
    {
      artifact: {
        kind: "still",
        resourceId,
        width: crop.width,
        height: crop.height,
        completeness: crop.completeness,
      },
      resources: [
        {
          id: resourceId,
          kind: "image",
          mime: "image/png",
          bytes: crop.bytes.byteLength,
          sha256: await sha256Hex(crop.bytes),
          data: bytesToBase64(crop.bytes),
          width: crop.width,
          height: crop.height,
        },
      ],
      diagnostics: crop.completeness === "cropped" ? [{ code: "still.cropped", count: 1 }] : [],
      claims: {
        sourceFrame: {
          width: Math.round(selection.viewportWidth),
          height: Math.round(selection.viewportHeight),
          devicePixelRatio: selection.devicePixelRatio,
        },
        time: { kind: "locked-frame", atMs: 0 },
        reflow: "fixed-viewport",
      },
    },
    validationOptions(signal),
  );
}

export async function buildEditableCapture(
  draft: EditableDomDraft,
  islands: ReadonlyArray<{
    id: string;
    crop: Omit<CroppedPng, "mime"> & { mime: "image/png" | "image/webp" };
  }>,
  selection: SelectionRect,
  signal: AbortSignal,
) {
  const resources = await Promise.all(
    islands.map(async ({ id, crop }) => ({
      id,
      kind: "image" as const,
      mime: crop.mime,
      bytes: crop.bytes.byteLength,
      sha256: await sha256Hex(crop.bytes),
      data: bytesToBase64(crop.bytes),
      width: crop.width,
      height: crop.height,
    })),
  );
  const modelResources = await Promise.all(
    draft.modelIslands.map(async (model) => ({
      id: model.id,
      kind: "model" as const,
      mime: model.mime,
      bytes: model.bytes,
      sha256: await sha256Hex(
        Uint8Array.from(atob(model.data), (character) => character.charCodeAt(0)),
      ),
      data: model.data,
    })),
  );
  return buildWebCaptureText(
    {
      artifact: {
        kind: "editable-dom",
        html: draft.html,
        css: draft.css,
        width: draft.width,
        height: draft.height,
      },
      resources: [...resources, ...modelResources],
      diagnostics: [
        { code: "animation.staticized", count: 1 },
        ...(resources.length > 0
          ? [{ code: "opaque.replaced" as const, count: resources.length }]
          : []),
        ...(modelResources.length > 0
          ? [{ code: "model.localized" as const, count: modelResources.length }]
          : []),
      ],
      claims: {
        sourceFrame: {
          width: Math.round(selection.viewportWidth),
          height: Math.round(selection.viewportHeight),
          devicePixelRatio: selection.devicePixelRatio,
        },
        time: { kind: "locked-frame", atMs: 0 },
        reflow: "fixed-viewport",
      },
    },
    validationOptions(signal),
  );
}

export function validateCaptureText(text: string, signal?: AbortSignal) {
  return parseWebCaptureText(text, validationOptions(signal));
}
