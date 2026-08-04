import { z } from "zod";

/**
 * The selection snapshot Studio publishes for external agents to read.
 *
 * It arrives from the browser, so it is declared once as a schema and the
 * server's public types are inferred from it — the validator and the type can
 * never drift apart, which is exactly what a hand-written guard beside a
 * hand-written interface cannot promise.
 */

export const studioSelectionTextFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  tagName: z.string(),
  source: z.enum(["self", "child", "text-node"]),
});

const stringRecordSchema = z.record(z.string(), z.string());

export const studioSelectionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  compositionPath: z.string(),
  sourceFile: z.string(),
  currentTime: z.number().finite(),
  target: z.object({
    id: z.string().nullish(),
    hfId: z.string().optional(),
    selector: z.string().optional(),
    selectorIndex: z.number().finite().optional(),
  }),
  label: z.string(),
  tagName: z.string(),
  boundingBox: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  }),
  textContent: z.string().nullable(),
  dataAttributes: stringRecordSchema,
  inlineStyles: stringRecordSchema,
  computedStyles: stringRecordSchema,
  textFields: z.array(studioSelectionTextFieldSchema),
  /** Feature flags the client reports; unknown keys are passed through as-is. */
  capabilities: z.record(z.string(), z.union([z.boolean(), z.string(), z.undefined()])),
  thumbnailUrl: z.string(),
});

/** PUT body: a snapshot to store, or an explicit null to clear the slot. */
export const studioSelectionRequestSchema = z.object({
  selection: studioSelectionSnapshotSchema.nullable(),
});

export type StudioSelectionTextField = z.infer<typeof studioSelectionTextFieldSchema>;
export type StudioSelectionSnapshot = z.infer<typeof studioSelectionSnapshotSchema>;

export interface StudioSelectionResponse {
  selection: StudioSelectionSnapshot | null;
  updatedAt: string | null;
}
