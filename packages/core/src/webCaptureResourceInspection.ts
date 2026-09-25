import type {
  WebCaptureFailure,
  WebCaptureResource,
  WebCaptureResourceInspection,
  WebCaptureResourceMaterializer,
} from "./webCaptureTypes";
import { WEB_CAPTURE_BUDGETS } from "./webCaptureBudgets";
import { sha256Hex } from "./webCaptureCanonicalJson";

export interface WebCapturePreparedResource {
  resource: WebCaptureResource;
  bytes: Uint8Array;
  inspected: WebCaptureResourceInspection;
}

export type WebCaptureResourcePreparation =
  | { ok: true; value: WebCapturePreparedResource }
  | WebCaptureFailure;

function decodeCanonicalBase64(data: string): Uint8Array | null {
  if (data.length % 4 !== 0) return null;
  let padding = 0;
  if (data.endsWith("==")) padding = 2;
  else if (data.endsWith("=")) padding = 1;
  const contentEnd = data.length - padding;
  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index);
    const alphabet =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
    if (index < contentEnd ? !alphabet : code !== 0x3d) return null;
  }
  try {
    const decoded = atob(data);
    if (btoa(decoded) !== data) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function prepareWebCaptureResource(
  resource: WebCaptureResource,
): Promise<WebCaptureResourcePreparation> {
  const bytes = decodeCanonicalBase64(resource.data);
  if (bytes === null || bytes.byteLength !== resource.bytes) {
    return { ok: false, code: "resource.invalid-data", resourceId: resource.id };
  }
  const inspected = inspectWebCaptureResource(bytes);
  if (!inspected) return { ok: false, code: "resource.invalid-data", resourceId: resource.id };
  const inspectionFailure = compareWebCaptureResourceInspection(resource, inspected);
  if (inspectionFailure) return inspectionFailure;
  if ((await sha256Hex(bytes)) !== resource.sha256) {
    return { ok: false, code: "resource.hash-mismatch", resourceId: resource.id };
  }
  return { ok: true, value: { resource, bytes, inspected } };
}

export function validateWebCaptureUniqueResourceIds(
  resources: readonly WebCaptureResource[],
): WebCaptureFailure | null {
  const ids = new Set<string>();
  for (const resource of resources) {
    if (ids.has(resource.id)) {
      return { ok: false, code: "resource.duplicate-id", resourceId: resource.id };
    }
    ids.add(resource.id);
  }
  return null;
}

export async function withinWebCaptureResourcePhase<T>(
  sourceSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) abortFromSource();
  else sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Resource phase deadline exceeded", "TimeoutError")),
    WEB_CAPTURE_BUDGETS.phaseDeadlineMs,
  );
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

function materializeWithAbort(
  bytes: Uint8Array,
  inspected: WebCaptureResourceInspection,
  materializeResource: WebCaptureResourceMaterializer,
  signal: AbortSignal,
): Promise<WebCaptureResourceInspection | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => settle(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    Promise.resolve()
      .then(() => materializeResource(bytes, inspected, signal))
      .then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
  });
}

export async function validateWebCaptureResourceMaterialization(
  resource: WebCaptureResource,
  bytes: Uint8Array,
  inspected: WebCaptureResourceInspection,
  materializeResource: WebCaptureResourceMaterializer,
  signal: AbortSignal,
): Promise<WebCaptureFailure | null> {
  let materialized: WebCaptureResourceInspection | null;
  try {
    materialized = await materializeWithAbort(bytes, inspected, materializeResource, signal);
  } catch (error) {
    const aborted =
      signal.aborted ||
      (typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError");
    return {
      ok: false,
      code: aborted ? "resource.materialization-aborted" : "resource.materialization-failed",
      resourceId: resource.id,
    };
  }
  if (!materialized) return { ok: false, code: "resource.invalid-data", resourceId: resource.id };
  return compareWebCaptureResourceInspection(resource, materialized);
}

function compareWebCaptureResourceInspection(
  resource: WebCaptureResource,
  inspected: WebCaptureResourceInspection,
): WebCaptureFailure | null {
  if (inspected.mime !== resource.mime)
    return { ok: false, code: "resource.mime-mismatch", resourceId: resource.id };
  if (
    (resource.kind === "image" || resource.kind === "media") &&
    (inspected.width !== resource.width || inspected.height !== resource.height)
  )
    return { ok: false, code: "resource.dimensions-mismatch", resourceId: resource.id };
  if (resource.kind === "font" && inspected.decodedBytes !== resource.decodedBytes)
    return { ok: false, code: "resource.decoded-size-mismatch", resourceId: resource.id };
  if (resource.kind === "media" && inspected.durationMs !== resource.durationMs)
    return { ok: false, code: "resource.duration-mismatch", resourceId: resource.id };
  return null;
}

interface ByteRange {
  start: number;
  end: number;
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function inspectPng(bytes: Uint8Array): WebCaptureResourceInspection | null {
  if (!hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (bytes.length < 24 || !hasBytes(bytes, 12, [0x49, 0x48, 0x44, 0x52])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { mime: "image/png", width, height } : null;
}

const JPEG_SIZE_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const JPEG_STOP_MARKERS = new Set([0xd9, 0xda]);
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function skipJpegMarkerPadding(bytes: Uint8Array, offset: number): number {
  let cursor = offset;
  while (bytes[cursor] === 0xff) cursor += 1;
  return cursor;
}

function jpegDimensions(
  view: DataView,
  marker: number,
  offset: number,
  length: number,
): WebCaptureResourceInspection | null {
  if (!JPEG_SIZE_MARKERS.has(marker) || length < 8) return null;
  const height = view.getUint16(offset + 3);
  const width = view.getUint16(offset + 5);
  return width > 0 && height > 0 ? { mime: "image/jpeg", width, height } : null;
}

interface JpegSegment {
  nextOffset: number;
  dimensions: WebCaptureResourceInspection | null;
}

function readJpegSegment(
  bytes: Uint8Array,
  view: DataView,
  marker: number,
  offset: number,
): JpegSegment | null {
  if (offset + 2 > bytes.length) return null;
  const length = view.getUint16(offset);
  if (length < 2) return null;
  if (offset + length > bytes.length) return null;
  return {
    nextOffset: offset + length,
    dimensions: jpegDimensions(view, marker, offset, length),
  };
}

function inspectJpeg(bytes: Uint8Array): WebCaptureResourceInspection | null {
  if (!hasBytes(bytes, 0, [0xff, 0xd8])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    offset = skipJpegMarkerPadding(bytes, offset);
    const marker = bytes[offset++]!;
    if (JPEG_STOP_MARKERS.has(marker)) return null;
    if (JPEG_STANDALONE_MARKERS.has(marker)) continue;
    const segment = readJpegSegment(bytes, view, marker, offset);
    if (!segment) return null;
    if (segment.dimensions) return segment.dimensions;
    offset = segment.nextOffset;
  }
  return null;
}

function hasWebpHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 30) return false;
  if (!hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46])) return false;
  return hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
}

function inspectExtendedWebp(
  bytes: Uint8Array,
  view: DataView,
): WebCaptureResourceInspection | null {
  if (!hasBytes(bytes, 12, [0x56, 0x50, 0x38, 0x58])) return null;
  if (view.getUint32(16, true) !== 10) return null;
  return {
    mime: "image/webp",
    width: readUint24LE(bytes, 24) + 1,
    height: readUint24LE(bytes, 27) + 1,
  };
}

function inspectLosslessWebp(
  bytes: Uint8Array,
  view: DataView,
): WebCaptureResourceInspection | null {
  if (!hasBytes(bytes, 12, [0x56, 0x50, 0x38, 0x4c])) return null;
  if (bytes[20] !== 0x2f) return null;
  const bits = view.getUint32(21, true);
  return {
    mime: "image/webp",
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
  };
}

function inspectLossyWebp(bytes: Uint8Array, view: DataView): WebCaptureResourceInspection | null {
  if (!hasBytes(bytes, 12, [0x56, 0x50, 0x38, 0x20])) return null;
  if (!hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) return null;
  return {
    mime: "image/webp",
    width: view.getUint16(26, true) & 0x3fff,
    height: view.getUint16(28, true) & 0x3fff,
  };
}

function inspectWebp(bytes: Uint8Array): WebCaptureResourceInspection | null {
  if (!hasWebpHeader(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return null;
  return (
    inspectExtendedWebp(bytes, view) ??
    inspectLosslessWebp(bytes, view) ??
    inspectLossyWebp(bytes, view)
  );
}

function inspectWoff2(bytes: Uint8Array): WebCaptureResourceInspection | null {
  if (bytes.length < 48 || !hasBytes(bytes, 0, [0x77, 0x4f, 0x46, 0x32])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = view.getUint32(8);
  const decodedBytes = view.getUint32(16);
  return declaredLength === bytes.length && decodedBytes > 0
    ? { mime: "font/woff2", decodedBytes }
    : null;
}

function hasExternalGltfUri(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const collectionName of ["buffers", "images"] as const) {
    const collection = record[collectionName];
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return true;
      const uri = (item as Record<string, unknown>).uri;
      if (typeof uri === "string" && !uri.startsWith("data:")) return true;
    }
  }
  return false;
}

function inspectGlb(bytes: Uint8Array): WebCaptureResourceInspection | null {
  if (bytes.length < 20 || !hasBytes(bytes, 0, [0x67, 0x6c, 0x54, 0x46])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) return null;
  const jsonLength = view.getUint32(12, true);
  if (jsonLength === 0 || jsonLength % 4 !== 0 || 20 + jsonLength > bytes.length) return null;
  if (view.getUint32(16, true) !== 0x4e4f534a) return null;
  let gltf: unknown;
  try {
    let json = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(20, 20 + jsonLength),
    );
    while (json.endsWith("\0") || json.endsWith(" ")) json = json.slice(0, -1);
    gltf = JSON.parse(json);
  } catch {
    return null;
  }
  if (gltf === null || typeof gltf !== "object" || Array.isArray(gltf)) return null;
  const asset = (gltf as Record<string, unknown>).asset;
  if (
    asset === null ||
    typeof asset !== "object" ||
    Array.isArray(asset) ||
    (asset as Record<string, unknown>).version !== "2.0" ||
    hasExternalGltfUri(gltf)
  ) {
    return null;
  }
  let offset = 20 + jsonLength;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const chunkLength = view.getUint32(offset, true);
    if (chunkLength % 4 !== 0 || offset + 8 + chunkLength > bytes.length) return null;
    offset += 8 + chunkLength;
  }
  return offset === bytes.length ? { mime: "model/gltf-binary" } : null;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function findMp4Boxes(bytes: Uint8Array, range: ByteRange, type: string): ByteRange[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches: ByteRange[] = [];
  let offset = range.start;
  while (offset + 8 <= range.end) {
    const size = view.getUint32(offset);
    const boxType = readAscii(bytes, offset + 4, 4);
    if (size < 8 || offset + size > range.end) return [];
    if (boxType === type) matches.push({ start: offset + 8, end: offset + size });
    offset += size;
  }
  return offset === range.end ? matches : [];
}

function inspectMp4Duration(bytes: Uint8Array, moov: ByteRange): number | null {
  const mvhd = findMp4Boxes(bytes, moov, "mvhd")[0];
  if (!mvhd) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[mvhd.start];
  const timescaleOffset = version === 1 ? 20 : 12;
  const durationOffset = version === 1 ? 24 : 16;
  if (mvhd.start + durationOffset + (version === 1 ? 8 : 4) > mvhd.end) return null;
  const timescale = view.getUint32(mvhd.start + timescaleOffset);
  const duration =
    version === 1
      ? Number(view.getBigUint64(mvhd.start + durationOffset))
      : view.getUint32(mvhd.start + durationOffset);
  return timescale > 0 && Number.isSafeInteger(duration)
    ? Math.round((duration * 1000) / timescale)
    : null;
}

function inspectMp4Dimensions(bytes: Uint8Array, moov: ByteRange): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const trak of findMp4Boxes(bytes, moov, "trak")) {
    const tkhd = findMp4Boxes(bytes, trak, "tkhd")[0];
    if (!tkhd) continue;
    const dimensionOffset = bytes[tkhd.start] === 1 ? 88 : 76;
    if (tkhd.start + dimensionOffset + 8 > tkhd.end) continue;
    const width = view.getUint32(tkhd.start + dimensionOffset) >>> 16;
    const height = view.getUint32(tkhd.start + dimensionOffset + 4) >>> 16;
    if (width > 0 && height > 0) return [width, height];
  }
  return null;
}

function inspectMp4(bytes: Uint8Array): WebCaptureResourceInspection | null {
  const whole = { start: 0, end: bytes.length };
  if (findMp4Boxes(bytes, whole, "ftyp").length === 0) return null;
  const moov = findMp4Boxes(bytes, whole, "moov")[0];
  if (!moov) return null;
  const dimensions = inspectMp4Dimensions(bytes, moov);
  const durationMs = inspectMp4Duration(bytes, moov);
  return dimensions && durationMs !== null
    ? { mime: "video/mp4", width: dimensions[0], height: dimensions[1], durationMs }
    : null;
}

interface EbmlVint {
  value: number;
  length: number;
  unknown: boolean;
}

function ebmlVintLength(first: number): number | null {
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && length < 8) {
    length += 1;
    mask >>= 1;
  }
  return first & mask ? length : null;
}

function isUnknownEbmlSize(bytes: Uint8Array, offset: number, length: number): boolean {
  const markerMask = 0x80 >> (length - 1);
  if ((bytes[offset]! & (markerMask - 1)) !== markerMask - 1) return false;
  return bytes.subarray(offset + 1, offset + length).every((byte) => byte === 0xff);
}

function readEbmlVintHeader(
  bytes: Uint8Array,
  offset: number,
): { first: number; length: number } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  const length = ebmlVintLength(first);
  return length !== null && offset + length <= bytes.length ? { first, length } : null;
}

function readEbmlVint(bytes: Uint8Array, offset: number, keepMarker: boolean): EbmlVint | null {
  const header = readEbmlVintHeader(bytes, offset);
  if (!header) return null;
  const { first, length } = header;
  if (!keepMarker && isUnknownEbmlSize(bytes, offset, length))
    return { value: 0, length, unknown: true };
  const markerMask = 0x80 >> (length - 1);
  let value = keepMarker ? first : first & (markerMask - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return Number.isSafeInteger(value) ? { value, length, unknown: false } : null;
}

function findEbmlElements(bytes: Uint8Array, range: ByteRange, id: number): ByteRange[] {
  const matches: ByteRange[] = [];
  let offset = range.start;
  while (offset < range.end) {
    const elementId = readEbmlVint(bytes, offset, true);
    if (!elementId) return [];
    const size = readEbmlVint(bytes, offset + elementId.length, false);
    if (!size) return [];
    const start = offset + elementId.length + size.length;
    const end = size.unknown ? range.end : start + size.value;
    if (end > range.end) return [];
    if (elementId.value === id) matches.push({ start, end });
    offset = end;
  }
  return matches;
}

function readEbmlUnsigned(bytes: Uint8Array, range: ByteRange): number | null {
  if (range.end <= range.start || range.end - range.start > 6) return null;
  let value = 0;
  for (let offset = range.start; offset < range.end; offset += 1)
    value = value * 256 + bytes[offset]!;
  return Number.isSafeInteger(value) ? value : null;
}

function readEbmlFloat(bytes: Uint8Array, range: ByteRange): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = range.end - range.start;
  if (length === 4) return view.getFloat32(range.start);
  return length === 8 ? view.getFloat64(range.start) : null;
}

function inspectWebmDuration(bytes: Uint8Array, info: ByteRange): number | null {
  const durationRange = findEbmlElements(bytes, info, 0x4489)[0];
  const scaleRange = findEbmlElements(bytes, info, 0x2ad7b1)[0];
  const duration = durationRange ? readEbmlFloat(bytes, durationRange) : null;
  const scale = scaleRange ? readEbmlUnsigned(bytes, scaleRange) : 1_000_000;
  return duration && scale ? Math.round((duration * scale) / 1e6) : null;
}

function inspectWebmDimensions(bytes: Uint8Array, tracks: ByteRange): [number, number] | null {
  const entry = findEbmlElements(bytes, tracks, 0xae).find((candidate) =>
    findEbmlElements(bytes, candidate, 0xe0).some(Boolean),
  );
  const video = entry ? findEbmlElements(bytes, entry, 0xe0)[0] : undefined;
  const widthRange = video ? findEbmlElements(bytes, video, 0xb0)[0] : undefined;
  const heightRange = video ? findEbmlElements(bytes, video, 0xba)[0] : undefined;
  const width = widthRange ? readEbmlUnsigned(bytes, widthRange) : null;
  const height = heightRange ? readEbmlUnsigned(bytes, heightRange) : null;
  return width && height ? [width, height] : null;
}

function inspectWebm(bytes: Uint8Array): WebCaptureResourceInspection | null {
  if (!hasBytes(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  const segment = findEbmlElements(bytes, { start: 0, end: bytes.length }, 0x18538067)[0];
  if (!segment) return null;
  const info = findEbmlElements(bytes, segment, 0x1549a966)[0];
  const tracks = findEbmlElements(bytes, segment, 0x1654ae6b)[0];
  if (!info || !tracks) return null;
  const durationMs = inspectWebmDuration(bytes, info);
  const dimensions = inspectWebmDimensions(bytes, tracks);
  return durationMs && dimensions
    ? { mime: "video/webm", width: dimensions[0], height: dimensions[1], durationMs }
    : null;
}

export function inspectWebCaptureResource(bytes: Uint8Array): WebCaptureResourceInspection | null {
  return (
    inspectGlb(bytes) ??
    inspectPng(bytes) ??
    inspectJpeg(bytes) ??
    inspectWebp(bytes) ??
    inspectWoff2(bytes) ??
    inspectMp4(bytes) ??
    inspectWebm(bytes)
  );
}
