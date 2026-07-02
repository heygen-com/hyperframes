import type { FigmaAssetFormat, FigmaRef } from "./types";

/** Typed capability/transport failures per design spec §4.4. */
export type FigmaClientErrorCode =
  | "NO_TOKEN"
  | "BAD_TOKEN"
  | "REQUIRES_ENTERPRISE"
  | "RATE_LIMITED"
  | "RENDER_FAILED"
  | "NODE_NOT_FOUND"
  | "HTTP_ERROR";

export class FigmaClientError extends Error {
  readonly code: FigmaClientErrorCode;
  readonly status?: number;

  constructor(code: FigmaClientErrorCode, message: string, status?: number) {
    super(message);
    this.name = "FigmaClientError";
    this.code = code;
    this.status = status;
  }
}

/** Injectable fetch so tests never touch the network. */
export type FigmaFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

export interface RenderNodeOptions {
  format: FigmaAssetFormat;
  scale?: number;
}

export interface RenderedNode {
  /** short-lived figma CDN url — freeze it immediately */
  url: string;
  ext: FigmaAssetFormat;
}

export interface FigmaVariablePayload {
  name: string;
  key?: string;
  resolvedType?: string;
  valuesByMode?: Record<string, unknown>;
  variableCollectionId?: string;
}

export interface FigmaVariablesResult {
  variables: Record<string, FigmaVariablePayload>;
  variableCollections: Record<string, unknown>;
}

export interface FigmaStyleMeta {
  key: string;
  name: string;
  style_type: string;
  node_id?: string;
  description?: string;
}

/** Raw figma node document from GET /v1/files/:key/nodes. Field-level shape
 *  is consumed by nodeToHtml; kept loose here on purpose — consumers narrow
 *  children/fills/etc themselves. */
export interface FigmaNodeDocument {
  id: string;
  name: string;
  type: string;
  [field: string]: unknown;
}

export interface FigmaFileVersion {
  version: string;
  lastModified: string;
}

export interface FigmaClient {
  renderNode(ref: FigmaRef, opts: RenderNodeOptions): Promise<RenderedNode>;
  imageFills(fileKey: string): Promise<Map<string, string>>;
  variables(fileKey: string): Promise<FigmaVariablesResult>;
  styles(fileKey: string): Promise<FigmaStyleMeta[]>;
  nodeTree(ref: FigmaRef): Promise<FigmaNodeDocument>;
  fileVersion(fileKey: string): Promise<FigmaFileVersion>;
}

export interface FigmaClientOptions {
  token: string;
  fetch?: FigmaFetch;
  baseUrl?: string;
}

function requireNodeId(ref: FigmaRef): string {
  if (!ref.nodeId) throw new Error(`figma ref ${ref.fileKey} has no nodeId`);
  return ref.nodeId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toVariablePayload(payload: unknown): FigmaVariablePayload | null {
  if (!isRecord(payload) || typeof payload.name !== "string") return null;
  return {
    name: payload.name,
    key: optionalString(payload.key),
    resolvedType: optionalString(payload.resolvedType),
    valuesByMode: isRecord(payload.valuesByMode) ? payload.valuesByMode : undefined,
    variableCollectionId: optionalString(payload.variableCollectionId),
  };
}

export function createFigmaClient(options: FigmaClientOptions): FigmaClient {
  const token = options.token.trim();
  if (token === "") {
    throw new FigmaClientError(
      "NO_TOKEN",
      "FIGMA_TOKEN is missing — mint a personal access token at figma.com/settings and export FIGMA_TOKEN",
    );
  }
  const doFetch: FigmaFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const base = options.baseUrl ?? "https://api.figma.com";

  async function get(path: string, enterpriseGated = false): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      headers: { "X-Figma-Token": token },
    });
    if (res.status === 401)
      throw new FigmaClientError("BAD_TOKEN", "figma rejected the token (401)", 401);
    if (res.status === 403 && enterpriseGated)
      throw new FigmaClientError(
        "REQUIRES_ENTERPRISE",
        "figma variables require an Enterprise plan (403) — fall back to styles",
        403,
      );
    if (res.status === 429)
      throw new FigmaClientError(
        "RATE_LIMITED",
        "figma rate limit hit (429) — back off and retry",
        429,
      );
    if (!res.ok)
      throw new FigmaClientError(
        "HTTP_ERROR",
        `figma request failed: HTTP ${res.status} ${path}`,
        res.status,
      );
    return res.json();
  }

  return {
    async renderNode(ref, opts) {
      const nodeId = requireNodeId(ref);
      const params = new URLSearchParams({ ids: nodeId, format: opts.format });
      if (opts.scale !== undefined) params.set("scale", String(opts.scale));
      const body = await get(`/v1/images/${ref.fileKey}?${params}`);
      const images = isRecord(body) && isRecord(body.images) ? body.images : {};
      const url = images[nodeId];
      if (typeof url !== "string" || url === "")
        throw new FigmaClientError(
          "RENDER_FAILED",
          `figma could not render node ${nodeId} as ${opts.format}`,
        );
      return { url, ext: opts.format };
    },

    async imageFills(fileKey) {
      const body = await get(`/v1/files/${fileKey}/images`);
      const meta = isRecord(body) && isRecord(body.meta) ? body.meta : {};
      const images = isRecord(meta.images) ? meta.images : {};
      const out = new Map<string, string>();
      for (const [ref, url] of Object.entries(images)) {
        if (typeof url === "string") out.set(ref, url);
      }
      return out;
    },

    async variables(fileKey) {
      const body = await get(`/v1/files/${fileKey}/variables/local`, true);
      const meta = isRecord(body) && isRecord(body.meta) ? body.meta : {};
      const variables = isRecord(meta.variables) ? meta.variables : {};
      const collections = isRecord(meta.variableCollections) ? meta.variableCollections : {};
      const typed: Record<string, FigmaVariablePayload> = {};
      for (const [id, payload] of Object.entries(variables)) {
        const v = toVariablePayload(payload);
        if (v) typed[id] = v;
      }
      return { variables: typed, variableCollections: collections };
    },

    async styles(fileKey) {
      const body = await get(`/v1/files/${fileKey}/styles`);
      const meta = isRecord(body) && isRecord(body.meta) ? body.meta : {};
      const styles = Array.isArray(meta.styles) ? meta.styles : [];
      return styles.filter(
        (s): s is FigmaStyleMeta =>
          isRecord(s) &&
          typeof s.key === "string" &&
          typeof s.name === "string" &&
          typeof s.style_type === "string",
      );
    },

    async nodeTree(ref) {
      const nodeId = requireNodeId(ref);
      const params = new URLSearchParams({ ids: nodeId, geometry: "paths" });
      const body = await get(`/v1/files/${ref.fileKey}/nodes?${params}`);
      const nodes = isRecord(body) && isRecord(body.nodes) ? body.nodes : {};
      const entry = nodes[nodeId];
      const doc = isRecord(entry) ? entry.document : undefined;
      if (
        !isRecord(doc) ||
        typeof doc.id !== "string" ||
        typeof doc.name !== "string" ||
        typeof doc.type !== "string"
      )
        throw new FigmaClientError("NODE_NOT_FOUND", `node ${nodeId} not found in ${ref.fileKey}`);
      return { ...doc, id: doc.id, name: doc.name, type: doc.type };
    },

    async fileVersion(fileKey) {
      const body = await get(`/v1/files/${fileKey}?depth=1`);
      const version = isRecord(body) && typeof body.version === "string" ? body.version : "";
      const lastModified =
        isRecord(body) && typeof body.lastModified === "string" ? body.lastModified : "";
      return { version, lastModified };
    },
  };
}
