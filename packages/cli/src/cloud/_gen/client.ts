/**
 * AUTO-GENERATED from experiment-framework/openapi/external-api.json.
 * DO NOT EDIT MANUALLY. Re-run
 * `python scripts/generate_hyperframes_cli_client.py` in
 * experiment-framework to regenerate.
 */
import type {
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

  /**
   * Upload Asset
   *
   * Uploads a file (image, video, audio, PDF, or SRT subtitle) and returns an asset_id for use in other endpoints. Max 50 MB, or 32 MB for an image. Supported types: png, jpeg, mp4, webm, mp3, wav, pdf, srt. A file is checked against the content policy after it is uploaded; if it is blocked, the asset is removed and later requests for it return not found.
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

  /**
   * Create Image
   *
   * Generate images with `gpt-image-2.5`, `nano-banana-2` or `nano-banana-2.1`, or edit the reference images when any are given. The request waits for the images and answers 200 with them; a generation is capped at 300 seconds. Send an `Idempotency-Key` header with every request: it is required. Repeating a request with the same key and body returns the original result instead of generating again, and a duplicate sent while the original is still running gets 409 `request_in_progress`. A request the workspace's API credits cannot cover at the model's list price is refused with 402 `insufficient_credit` before any work starts. The credits are charged once the images are generated, at what the image model billed for the request when it reports it, otherwise at the list price; a failed generation is not charged. If the balance no longer covers the charge when the images are ready, the request answers 402 `insufficient_credit` without them. The request body is capped at about 7.4 MiB, so inline `base64` references together must stay under about 5 MiB decoded; send larger or additional images as `url` or `asset_id`.
   */
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

  /**
   * Get Image
   *
   * Return a generation created by `POST /v3/images`: its images with fresh download URLs once completed, its failure code once failed, or `pending` while the creating request is still running.
   */
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

  /**
   * Create HeyGen Video
   *
   * Generates a scene with its sound from a prompt using HeyGen Video (`heygen-video-1`). Set `mode` to `text_to_video`, `image_to_video` or `reference_to_video`; reference-to-video takes up to fifteen references in total, and reference videos must be between 1:4 and 4:1. Returns 202 with a `video_id`; poll GET /v3/models/videos/{video_id}. Send an Idempotency-Key to retry safely; without one, each submission creates a new generation. To have an avatar speak a script, use POST /v3/videos.
   */
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

  /**
   * Get HeyGen Video
   *
   * Returns a HeyGen Video generation: `pending`, `processing`, `completed`, `failed` or `cancelled`. Completed results include a fresh `video_url`, duration and dimensions; failed results include `failure_code` and `failure_message`. Poll again to refresh an expired URL.
   */
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

  /**
   * Create Video
   *
   * Creates an avatar video: a HeyGen avatar or an image speaks your script or audio with lip-sync. Choose Avatar III, IV or V with `engine` (Avatar IV by default). To generate a whole scene from a prompt instead, use POST /v3/models/videos.
   */
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

  /**
   * Get Video
   *
   * Returns details for a video including status, video_url, thumbnail_url, duration, and failure info if applicable.
   */
  async getVideoV3(args: { video_id: string; signal?: AbortSignal }): Promise<VideoDetail> {
    return await this.request<VideoDetail>({
      method: "GET",
      path: `/v3/videos/${encodeURIComponent(args.video_id)}`,
      signal: args.signal,
    });
  }

  /**
   * List Voices
   *
   * Returns a paginated list of voices, filterable by type, engine, language, and gender. Each voice includes its speech default and available speech engines; a voice with no available engines cannot generate speech.
   */
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

  /**
   * Generate Speech
   *
   * Synthesizes speech from text with a catalog voice and returns an audio URL, its duration and optional word timestamps. Omit engine to use the voice's saved default and settings, or set it per request; choose an ElevenLabs model with settings: {model_id: 'eleven_v4'}. Requests that omit engine use HeyGen Voice for most public catalog voices. Set engine only to request a specific engine, for example engine: 'heygen_voice' for HeyGen Voice. The legacy 'orca' input remains accepted; response engine values retain 'orca' for compatibility. A professional HeyGen Voice clone is synthesized by POST /v3/models/audio/tts instead. HTTP 400: the saved default or explicit engine is unsupported, not allowed on your plan, or incompatible with the requested locale or language. HTTP 403 (ai_vendor_access_restricted): workspace vendor policy blocks ElevenLabs and all of its model variants.
   */
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

  /**
   * Create Music
   *
   * Generate a music track with `lyria-3-pro`. The request waits for the track and answers 200 with a time-limited `audio_url` to the mp3. `duration_seconds` is a target: a longer render is cut to it with a fade-out, and a shorter one is kept, so read the returned `duration_seconds` for the real length. Send an `Idempotency-Key` header with every request: it is required. Repeating a request with the same key and body returns the original track instead of generating again, and a duplicate sent while the original is still running gets 409 `request_in_progress`. Each track is priced at the vendor's flat per-song cost. A request the workspace's API credits cannot cover is refused with 402 `insufficient_credit` before the model runs. The credits are charged once the track is made, and a failed generation is not charged. If the balance no longer covers the charge when the track is ready, the request answers 402 `insufficient_credit` without it.
   */
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

  /**
   * Get Music
   *
   * Return a music job created by `POST /v3/audio/music`: a fresh `audio_url` once completed, its failure code once failed, or `pending` while the creating request is still running.
   */
  async getMusic(args: { music_id: string; signal?: AbortSignal }): Promise<MusicResponse> {
    return await this.request<MusicResponse>({
      method: "GET",
      path: `/v3/audio/music/${encodeURIComponent(args.music_id)}`,
      signal: args.signal,
    });
  }

  /**
   * Create Transcription
   *
   * Transcribe an audio or video file with `scribe-v2`. The request waits for the transcript and answers 200 with it. Audio is limited to 10 minutes with `diarize` on and 30 minutes with it off. Send an `Idempotency-Key` header with every request: it is required. Repeating a request with the same key and body returns the original result instead of transcribing again, and a duplicate sent while the original is still running gets 409 `request_in_progress`. The transcription is priced at the vendor's cost for the decoded audio length. A request the workspace's API credits cannot cover is refused with 402 `insufficient_credit` before the model runs. The credits are charged once the transcript is made, and a failed transcription is not charged. If the balance no longer covers the charge when the transcript is ready, the request answers 402 `insufficient_credit` without it. Read `status` rather than assuming the POST finished the transcription.
   */
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

  /**
   * Get Transcription
   *
   * Return a transcription created by `POST /v3/audio/transcriptions`: its transcript once completed, its failure code once failed, or `pending` while the creating request is still running.
   */
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

  /**
   * Create Lipsync
   *
   * Replaces the audio on an existing video and re-animates the speaker's lip movements to match the new audio. Use mode: 'speed' for fast output or 'precision' for high-quality lip-sync.
   */
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

  /**
   * Get Lipsync
   *
   * Returns details for a lipsync job including status, video_url, caption_url, and failure info if applicable.
   */
  async getLipsyncV3(args: { lipsync_id: string; signal?: AbortSignal }): Promise<LipsyncDetail> {
    return await this.request<LipsyncDetail>({
      method: "GET",
      path: `/v3/lipsyncs/${encodeURIComponent(args.lipsync_id)}`,
      signal: args.signal,
    });
  }

  /**
   * Create Background Removal
   *
   * Submits a video for background removal and returns a job; poll Get Background Removal with its id. A completed job has download URLs for the requested layers: `foreground`, `mask` and `background`. For idempotency, send `request_id` in the body. Available on all plans with sufficient credits. API requests cost $0.15 per input-video minute (9 API quota units, 18 on the enterprise base card, or 3 plan/generative credits per minute), rounded up to whole wallet units. Failed jobs are refunded. An insufficient-credit response allows retrying the same `request_id` after topping up; a concurrent replay may return a pending job that is removed if payment is refused. After a job is claimed, other submission failures retain a failed job; use a new `request_id` to try again. The `request_id` inside an error body identifies the HTTP request for support; it is not this idempotency key. Web/editor background removal remains free.
   */
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

  /**
   * Get Background Removal
   *
   * Returns a background removal job including its status and, once completed, presigned download URLs for the produced layers.
   */
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
