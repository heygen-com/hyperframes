import { createHash } from "node:crypto";
import type { RegistryItem } from "@hyperframes/core";

export const THREAD_MESSAGE_STACK_ARTIFACT_ID = "21c28523-7487-43e1-927d-43a7fe855859";
export const THREAD_MESSAGE_STACK_VERSION_ID = "1aa00c22-b508-4b81-a3a1-4702453d48c2";
export const THREAD_MESSAGE_STACK_CANONICAL_URI =
  "heygenverse://app/21c28523-7487-43e1-927d-43a7fe855859/version/1aa00c22-b508-4b81-a3a1-4702453d48c2";
export const THREAD_MESSAGE_STACK_CATALOG_DIGEST =
  "sha256:c8c5a26a43564d30f4866b35a0f182820bc6906596afb8bbbf0935d4cef22365";

export interface HeyGenVerseCatalogRecord {
  name: "thread-message-stack";
  type: "hyperframes:block";
  sourceDigest: string;
}

export interface HeyGenVerseCatalogProjection {
  schemaVersion: 1;
  artifactId: string;
  versionId: string;
  canonicalUri: string;
  exportedAt: string;
  records: HeyGenVerseCatalogRecord[];
  catalogDigest: string;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function projectionPayload(
  projection: Omit<HeyGenVerseCatalogProjection, "catalogDigest">,
): string {
  return JSON.stringify({
    schemaVersion: projection.schemaVersion,
    artifactId: projection.artifactId,
    versionId: projection.versionId,
    canonicalUri: projection.canonicalUri,
    exportedAt: projection.exportedAt,
    records: projection.records.map((record) => ({
      name: record.name,
      type: record.type,
      sourceDigest: record.sourceDigest,
    })),
  });
}

function catalogDigest(projection: Omit<HeyGenVerseCatalogProjection, "catalogDigest">): string {
  return `sha256:${createHash("sha256").update(projectionPayload(projection)).digest("hex")}`;
}

// Strict validation intentionally keeps every immutable identity check explicit.
// fallow-ignore-next-line complexity
export function parseHeyGenVerseCatalogProjection(source: string): HeyGenVerseCatalogProjection {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("HeyGenVerse catalog projection contains invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("HeyGenVerse catalog projection must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("Unsupported catalog schema version.");
  if (record.artifactId !== THREAD_MESSAGE_STACK_ARTIFACT_ID) {
    throw new Error("HeyGenVerse catalog artifact identity does not match the canonical artifact.");
  }
  if (record.versionId !== THREAD_MESSAGE_STACK_VERSION_ID) {
    throw new Error("HeyGenVerse catalog version does not match the canonical version.");
  }
  if (record.canonicalUri !== THREAD_MESSAGE_STACK_CANONICAL_URI) {
    throw new Error("HeyGenVerse catalog canonical URI does not match the canonical version.");
  }
  if (typeof record.exportedAt !== "string" || Number.isNaN(Date.parse(record.exportedAt))) {
    throw new Error("HeyGenVerse catalog exportedAt must be an ISO timestamp.");
  }
  if (!Array.isArray(record.records) || record.records.length !== 1) {
    throw new Error("HeyGenVerse catalog must project exactly one thread-message-stack record.");
  }
  const projected = record.records[0] as Record<string, unknown>;
  if (
    projected?.name !== "thread-message-stack" ||
    projected.type !== "hyperframes:block" ||
    !isDigest(projected.sourceDigest)
  ) {
    throw new Error("HeyGenVerse catalog record diverges from thread-message-stack provenance.");
  }
  if (!isDigest(record.catalogDigest)) {
    throw new Error("HeyGenVerse catalog digest is missing or malformed.");
  }
  const projection: HeyGenVerseCatalogProjection = {
    schemaVersion: 1,
    artifactId: record.artifactId,
    versionId: record.versionId,
    canonicalUri: record.canonicalUri,
    exportedAt: record.exportedAt,
    records: [
      {
        name: "thread-message-stack",
        type: "hyperframes:block",
        sourceDigest: projected.sourceDigest,
      },
    ],
    catalogDigest: record.catalogDigest,
  };
  const { catalogDigest: suppliedDigest, ...payload } = projection;
  if (catalogDigest(payload) !== suppliedDigest) {
    throw new Error("HeyGenVerse catalog digest does not match its immutable projection payload.");
  }
  if (suppliedDigest !== THREAD_MESSAGE_STACK_CATALOG_DIGEST) {
    throw new Error("HeyGenVerse catalog digest does not match the canonical export version.");
  }
  return projection;
}

export function assertHeyGenVerseProjectedItem(
  item: RegistryItem,
  projection: HeyGenVerseCatalogProjection,
): void {
  if (item.name !== "thread-message-stack") return;
  const provenance = item.provenance;
  const projected = projection.records[0];
  if (
    provenance?.kind !== "heygenverse-export" ||
    provenance.artifactId !== projection.artifactId ||
    provenance.versionId !== projection.versionId ||
    provenance.canonicalUri !== projection.canonicalUri ||
    provenance.sourceDigest !== projected?.sourceDigest
  ) {
    throw new Error("thread-message-stack registry item diverges from its HeyGenVerse projection.");
  }
}

export function assertHeyGenVerseSourceDigest(item: RegistryItem, source: string): void {
  if (item.name !== "thread-message-stack") return;
  const expected = item.provenance?.sourceDigest;
  const actual = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  if (!expected || actual !== expected) {
    throw new Error("thread-message-stack source digest diverges from its immutable projection.");
  }
}
