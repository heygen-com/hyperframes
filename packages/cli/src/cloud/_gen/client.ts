/**
 * AUTO-GENERATED from experiment-framework/openapi/external-api.json.
 * DO NOT EDIT MANUALLY. Re-run
 * `python scripts/generate_hyperframes_cli_client.py` in
 * experiment-framework to regenerate.
 */
import type {
  AbortAssetUploadResponse,
  BackgroundRemovalJob,
  CompleteAssetUploadRequest,
  CompleteAssetUploadResponse,
  CreateAssetUploadRequest,
  CreateAssetUploadResponse,
  CreateBackgroundRemovalRequest,
  CreateHyperframesRenderRequest,
  CreateHyperframesRenderResponse,
  CreateLipsyncRequest,
  CreateModelVideoRequest,
  CreateModelVideoResponse,
  CreateSpeechV3Request,
  CreateSpeechV3ResponseData,
  CreateVideoV3RequestBody,
  CreateVideoV3Response,
  DeleteHyperframesRenderResponse,
  HyperframesRenderDetail,
  ImageCreateRequest,
  LipsyncCreateResponse,
  LipsyncDetail,
  ListUploadedPartsResponse,
  MintPartUrlsRequest,
  MintPartUrlsResponse,
  ModelVideoResponse,
  MusicCreateRequest,
  MusicResponse,
  ThirdPartyImageResponse,
  TranscriptionCreateRequest,
  TranscriptionResponse,
  UploadAssetV3Response,
  VideoDetail,
  VoiceV3Item,
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

  async getAssetUploadPartUrls(args: {
    asset_id: string;
    body: MintPartUrlsRequest;
    signal?: AbortSignal;
  }): Promise<MintPartUrlsResponse> {
    return await this.request<MintPartUrlsResponse>({
      method: "POST",
      path: `/v3/assets/${encodeURIComponent(args.asset_id)}/parts`,
      body: args.body,
      signal: args.signal,
    });
  }

  async listAssetUploadParts(args: {
    asset_id: string;
    multipart_upload_id: string;
    signal?: AbortSignal;
  }): Promise<ListUploadedPartsResponse> {
    const query: Record<string, string | number | undefined> = {
      multipart_upload_id: args.multipart_upload_id,
    };
    return await this.request<ListUploadedPartsResponse>({
      method: "GET",
      path: `/v3/assets/${encodeURIComponent(args.asset_id)}/parts`,
      query,
      signal: args.signal,
    });
  }

  async abortAssetUploadParts(args: {
    asset_id: string;
    multipart_upload_id: string;
    signal?: AbortSignal;
  }): Promise<AbortAssetUploadResponse> {
    const query: Record<string, string | number | undefined> = {
      multipart_upload_id: args.multipart_upload_id,
    };
    return await this.request<AbortAssetUploadResponse>({
      method: "DELETE",
      path: `/v3/assets/${encodeURIComponent(args.asset_id)}/parts`,
      query,
      signal: args.signal,
    });
  }

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

  async createImage(args: {
    body: ImageCreateRequest;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<ThirdPartyImageResponse> {
    return await this.request<ThirdPartyImageResponse>({
      method: "POST",
      path: "/v3/images",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  async getImage(args: {
    generation_id: string;
    signal?: AbortSignal;
  }): Promise<ThirdPartyImageResponse> {
    return await this.request<ThirdPartyImageResponse>({
      method: "GET",
      path: `/v3/images/${encodeURIComponent(args.generation_id)}`,
      signal: args.signal,
    });
  }

  async createModelVideo(args: {
    body: CreateModelVideoRequest;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<CreateModelVideoResponse> {
    return await this.request<CreateModelVideoResponse>({
      method: "POST",
      path: "/v3/models/videos",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  async getModelVideo(args: {
    video_id: string;
    signal?: AbortSignal;
  }): Promise<ModelVideoResponse> {
    return await this.request<ModelVideoResponse>({
      method: "GET",
      path: `/v3/models/videos/${encodeURIComponent(args.video_id)}`,
      signal: args.signal,
    });
  }

  async createVideo(args: {
    body: CreateVideoV3RequestBody;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<CreateVideoV3Response> {
    return await this.request<CreateVideoV3Response>({
      method: "POST",
      path: "/v3/videos",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  async getVideoV3(args: { video_id: string; signal?: AbortSignal }): Promise<VideoDetail> {
    return await this.request<VideoDetail>({
      method: "GET",
      path: `/v3/videos/${encodeURIComponent(args.video_id)}`,
      signal: args.signal,
    });
  }

  async listVoicesV3(args: {
    type?: "public" | "private";
    engine?: string;
    language?: string;
    gender?: string;
    limit?: number;
    token?: string;
    signal?: AbortSignal;
  }): Promise<{ data?: Array<VoiceV3Item>; has_more?: boolean; next_token?: string | null }> {
    const query: Record<string, string | number | undefined> = {
      type: args.type,
      engine: args.engine,
      language: args.language,
      gender: args.gender,
      limit: args.limit,
      token: args.token,
    };
    return await this.request<{
      data?: Array<VoiceV3Item>;
      has_more?: boolean;
      next_token?: string | null;
    }>({
      method: "GET",
      path: "/v3/voices",
      query,
      unwrapData: false,
      signal: args.signal,
    });
  }

  async createSpeechV3(args: {
    body: CreateSpeechV3Request;
    signal?: AbortSignal;
  }): Promise<CreateSpeechV3ResponseData> {
    return await this.request<CreateSpeechV3ResponseData>({
      method: "POST",
      path: "/v3/voices/speech",
      body: args.body,
      signal: args.signal,
    });
  }

  async createMusic(args: {
    body: MusicCreateRequest;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<MusicResponse> {
    return await this.request<MusicResponse>({
      method: "POST",
      path: "/v3/audio/music",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  async getMusic(args: { music_id: string; signal?: AbortSignal }): Promise<MusicResponse> {
    return await this.request<MusicResponse>({
      method: "GET",
      path: `/v3/audio/music/${encodeURIComponent(args.music_id)}`,
      signal: args.signal,
    });
  }

  async createTranscription(args: {
    body: TranscriptionCreateRequest;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<TranscriptionResponse> {
    return await this.request<TranscriptionResponse>({
      method: "POST",
      path: "/v3/audio/transcriptions",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  async getTranscription(args: {
    transcription_id: string;
    signal?: AbortSignal;
  }): Promise<TranscriptionResponse> {
    return await this.request<TranscriptionResponse>({
      method: "GET",
      path: `/v3/audio/transcriptions/${encodeURIComponent(args.transcription_id)}`,
      signal: args.signal,
    });
  }

  async createLipsyncV3(args: {
    body: CreateLipsyncRequest;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<LipsyncCreateResponse> {
    return await this.request<LipsyncCreateResponse>({
      method: "POST",
      path: "/v3/lipsyncs",
      body: args.body,
      idempotencyKey: args.idempotencyKey,
      signal: args.signal,
    });
  }

  async getLipsyncV3(args: { lipsync_id: string; signal?: AbortSignal }): Promise<LipsyncDetail> {
    return await this.request<LipsyncDetail>({
      method: "GET",
      path: `/v3/lipsyncs/${encodeURIComponent(args.lipsync_id)}`,
      signal: args.signal,
    });
  }

  async createBackgroundRemoval(args: {
    body: CreateBackgroundRemovalRequest;
    signal?: AbortSignal;
  }): Promise<BackgroundRemovalJob> {
    return await this.request<BackgroundRemovalJob>({
      method: "POST",
      path: "/v3/background-removals",
      body: args.body,
      signal: args.signal,
    });
  }

  async getBackgroundRemoval(args: {
    job_id: string;
    signal?: AbortSignal;
  }): Promise<BackgroundRemovalJob> {
    return await this.request<BackgroundRemovalJob>({
      method: "GET",
      path: `/v3/background-removals/${encodeURIComponent(args.job_id)}`,
      signal: args.signal,
    });
  }
}
