/**
 * AUTO-GENERATED from experiment-framework/openapi/external-api.json.
 * DO NOT EDIT MANUALLY. Re-run
 * `python scripts/generate_hyperframes_cli_client.py` in
 * experiment-framework to regenerate.
 */
import type {
  CompleteAssetUploadRequest,
  CompleteAssetUploadResponse,
  CreateAssetUploadRequest,
  CreateAssetUploadResponse,
  CreateHyperframesRenderRequest,
  CreateHyperframesRenderResponse,
  DeleteHyperframesRenderResponse,
  HyperframesRenderDetail,
  UploadAssetV3Response,
} from "./types.js";

export type AuthHeaders = Record<string, string>;

/**
 * Caller-provided context. Keep the shape narrow so the cli/src/auth/
 * module stays the single owner of credential resolution.
 */
export interface HyperframesCloudClientOptions {
  /** Base URL like "https://api.heygen.com" (no trailing slash). */
  baseUrl: string;
  /**
   * Return the auth headers to attach to every request. Called once per
   * request so callers can refresh OAuth tokens transparently.
   */
  getAuthHeaders: () => Promise<AuthHeaders> | AuthHeaders;
  /** Override fetch (used by tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Standard error envelope used by /v3 endpoints. See StandardAPIError in
 * types.ts for the field shape.
 */
export class HyperframesApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly param?: string | null;
  readonly docUrl?: string | null;
  readonly raw: unknown;

  constructor(opts: {
    status: number;
    message: string;
    code?: string;
    param?: string | null;
    docUrl?: string | null;
    raw?: unknown;
  }) {
    super(opts.message);
    this.name = "HyperframesApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.param = opts.param;
    this.docUrl = opts.docUrl;
    this.raw = opts.raw;
  }
}

interface RequestOptions {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  multipart?: FormData;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /**
   * When true (default), the ``data`` wrapper of the standard /v3
   * response envelope is unwrapped before returning. List endpoints set
   * this to false so callers can read ``has_more`` / ``next_token``.
   */
  unwrapData?: boolean;
}

/**
 * Typed client for the HyperFrames cloud-render API. Auto-generated; do
 * not hand-edit. Submit new endpoints by adding them to
 * scripts/generate_hyperframes_cli_client.py in experiment-framework.
 */
export class HyperframesCloudClient {
  private readonly baseUrl: string;
  private readonly getAuthHeaders: () => Promise<AuthHeaders> | AuthHeaders;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HyperframesCloudClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.getAuthHeaders = opts.getAuthHeaders;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const auth = await this.getAuthHeaders();
    const headers: Record<string, string> = { ...auth };
    let body: BodyInit | undefined;

    if (opts.multipart) {
      body = opts.multipart;
      // fetch sets the multipart boundary automatically; do NOT set
      // Content-Type here or the upload will be rejected.
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    if (opts.idempotencyKey) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }

    const res = await this.fetchImpl(url, {
      method: opts.method,
      headers,
      body,
      signal: opts.signal,
    });

    if (!res.ok) {
      throw await this.toApiError(res);
    }

    // 204 No Content
    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text) {
      return undefined as T;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new HyperframesApiError({
        status: res.status,
        message: `Invalid JSON response: ${(err as Error).message}`,
        raw: text.slice(0, 500),
      });
    }
    // The /v3 envelope is {data: T, ...}. Unwrap when present and the
    // call site asked for it (the default) so consumers read the inner
    // payload directly. List endpoints opt out so they can read
    // ``has_more`` / ``next_token``.
    const unwrap = opts.unwrapData !== false;
    if (
      unwrap &&
      parsed &&
      typeof parsed === "object" &&
      "data" in (parsed as Record<string, unknown>)
    ) {
      const envelope = parsed as { data: T };
      return envelope.data;
    }
    return parsed as T;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async toApiError(res: Response): Promise<HyperframesApiError> {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    const err =
      parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)
        ? ((parsed as Record<string, unknown>).error as Record<string, unknown> | undefined)
        : undefined;
    return new HyperframesApiError({
      status: res.status,
      message:
        (err && typeof err.message === "string" && err.message) ||
        `HTTP ${res.status} ${res.statusText}`,
      code: err && typeof err.code === "string" ? err.code : undefined,
      param:
        err && (typeof err.param === "string" || err.param === null)
          ? (err.param as string | null)
          : undefined,
      docUrl:
        err && (typeof err.doc_url === "string" || err.doc_url === null)
          ? (err.doc_url as string | null)
          : undefined,
      raw: parsed,
    });
  }

  /**
   * Upload Asset
   *
   * Uploads a file (image, video, audio, or PDF) and returns an asset_id for use in other endpoints. Max 32 MB. Supported types: png, jpeg, mp4, webm, mp3, wav, pdf.
   */
  async uploadAsset(args: {
    file: Blob | Buffer | Uint8Array;
    filename: string;
    mimeType?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<UploadAssetV3Response> {
    const fd = new FormData();
    const blobOpts = args.mimeType ? { type: args.mimeType } : undefined;
    const blob =
      args.file instanceof Blob
        ? args.file
        : new Blob([args.file as unknown as BlobPart], blobOpts);
    fd.append("file", blob, args.filename);
    return await this.request<UploadAssetV3Response>({
      method: "POST",
      path: "/v3/assets",
      multipart: fd,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  /**
   * Create Asset Upload
   *
   * Begin a direct-to-S3 upload. Returns an asset_id and a presigned upload_url; PUT the file bytes to upload_url, then call POST /v3/assets/{asset_id}/complete. Unlike POST /v3/assets (which proxies the bytes), this never sends the file through the API.
   */
  async createAssetUpload(args: {
    body: CreateAssetUploadRequest;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<CreateAssetUploadResponse> {
    return await this.request<CreateAssetUploadResponse>({
      method: "POST",
      path: "/v3/assets/direct-uploads",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  /**
   * Complete Asset Upload
   *
   * Finalize a direct-to-S3 upload into a reusable asset. Call after the upload PUT returns 200. Idempotent: repeated calls return the same finalized asset.
   */
  async completeAssetUpload(args: {
    asset_id: string;
    body: CompleteAssetUploadRequest;
    signal?: AbortSignal;
  }): Promise<CompleteAssetUploadResponse> {
    return await this.request<CompleteAssetUploadResponse>({
      method: "POST",
      path: `/v3/assets/${encodeURIComponent(args.asset_id)}/complete`,
      body: args.body,
      signal: args.signal,
    });
  }

  /**
   * Create HyperFrames Render
   *
   * Renders a HyperFrames composition (an HTML+JS+assets project bundled as a .zip) into a video. Submit the project via `url`, `asset_id` (pre-uploaded via POST /v3/assets), or inline `base64`. Returns a `render_id` to poll via GET /v3/hyperframes/renders/{render_id}.
   */
  async createRender(args: {
    body: CreateHyperframesRenderRequest;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<CreateHyperframesRenderResponse> {
    return await this.request<CreateHyperframesRenderResponse>({
      method: "POST",
      path: "/v3/hyperframes/renders",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  /**
   * List HyperFrames Renders
   *
   * Returns a cursor-paginated list of HyperFrames renders in the account, newest first.
   */
  async listRenders(args: { limit?: number; token?: string; signal?: AbortSignal }): Promise<{
    data?: Array<HyperframesRenderDetail>;
    has_more?: boolean;
    next_token?: string | null;
  }> {
    const query: Record<string, string | number | undefined> = {
      limit: args.limit,
      token: args.token,
    };
    return await this.request<{
      data?: Array<HyperframesRenderDetail>;
      has_more?: boolean;
      next_token?: string | null;
    }>({
      method: "GET",
      path: "/v3/hyperframes/renders",
      query,
      unwrapData: false,
      signal: args.signal,
    });
  }

  /**
   * Get HyperFrames Render
   *
   * Returns full details for a single HyperFrames render, including status and signed video_url when complete.
   */
  async getRender(args: {
    render_id: string;
    signal?: AbortSignal;
  }): Promise<HyperframesRenderDetail> {
    return await this.request<HyperframesRenderDetail>({
      method: "GET",
      path: `/v3/hyperframes/renders/${encodeURIComponent(args.render_id)}`,
      signal: args.signal,
    });
  }

  /**
   * Delete HyperFrames Render
   *
   * Soft-deletes a HyperFrames render. Subsequent GETs return 404.
   */
  async deleteRender(args: {
    render_id: string;
    signal?: AbortSignal;
  }): Promise<DeleteHyperframesRenderResponse> {
    return await this.request<DeleteHyperframesRenderResponse>({
      method: "DELETE",
      path: `/v3/hyperframes/renders/${encodeURIComponent(args.render_id)}`,
      signal: args.signal,
    });
  }
}
