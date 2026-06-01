/**
 * AUTO-GENERATED from experiment-framework/openapi/external-api.json.
 * DO NOT EDIT MANUALLY. Re-run
 * `python scripts/generate_hyperframes_cli_client.py` in
 * experiment-framework to regenerate.
 */

// Component schemas reachable from the cloud-render endpoint set.
// Add a new path/method to TARGET_ENDPOINTS in
// scripts/generate_hyperframes_cli_client.py to extend this list.

/**
 * Asset input via base64-encoded content.
 */
export interface AssetBase64 {
  /**
   * Input type discriminator
   */
  type: "base64";
  /**
   * MIME type of the encoded content (e.g. "image/png")
   */
  media_type: string;
  /**
   * Base64-encoded file content
   */
  data: string;
}

/**
 * Asset input via HeyGen asset ID from the asset upload endpoint.
 */
export interface AssetId {
  /**
   * Input type discriminator
   */
  type: "asset_id";
  /**
   * HeyGen asset ID from the asset upload endpoint
   */
  asset_id: string;
}

/**
 * Asset input via publicly accessible HTTPS URL.
 */
export interface AssetUrl {
  /**
   * Input type discriminator
   */
  type: "url";
  /**
   * Publicly accessible HTTPS URL for the asset
   */
  url: string;
}

/**
 * Request body for POST /v3/hyperframes/renders.
 */
export interface CreateHyperframesRenderRequest {
  /**
   * HyperFrames composition .zip — provide as {type: 'url', url: '...'}, {type:
   * 'asset_id', asset_id: '...'} (pre-uploaded via POST /v3/assets), or {type:
   * 'base64', media_type: 'application/zip', data: '...'}. Zip must contain
   * index.html at the root (or the path you set in `composition`).
   */
  project: AssetUrl | AssetId | AssetBase64;
  /**
   * Output frames per second. Defaults to 30 if not provided.
   */
  fps?: number | null;
  /**
   * Render quality preset; higher quality is slower.
   */
  quality?: "draft" | "standard" | "high";
  /**
   * Output container/codec.
   */
  format?: "mp4" | "webm" | "mov";
  /**
   * Output resolution tier. Defaults to '1080p'. Pass '4k' for 4K renders
   * (billed at 1.5x).
   */
  resolution?: HyperframesResolution;
  /**
   * Output aspect ratio. Defaults to '16:9' (landscape). Pass '9:16' for
   * portrait or '1:1' for square.
   */
  aspect_ratio?: HyperframesAspectRatio;
  /**
   * Entry HTML file relative to the project root (e.g. compositions/intro.html).
   * Defaults to index.html when omitted.
   */
  composition?: string | null;
  /**
   * Optional overrides for the composition's data-composition-variables. Use
   * this to parameterise a single composition across multiple renders.
   */
  variables?: Record<string, unknown> | null;
  /**
   * Free-text label for the render; echoed back in detail responses.
   */
  title?: string | null;
  /**
   * Opaque client tracking ID, echoed back in webhook payloads.
   */
  callback_id?: string | null;
  /**
   * Per-request HTTPS webhook URL the render fires when it terminates.
   */
  callback_url?: string | null;
}

/**
 * Response for POST /v3/hyperframes/renders.
 */
export interface CreateHyperframesRenderResponse {
  /**
   * HyperFrames render identifier — poll GET /v3/hyperframes/renders/{render_id}
   * for status.
   */
  render_id: string;
}

/**
 * Response for DELETE /v3/hyperframes/renders/{render_id}.
 */
export interface DeleteHyperframesRenderResponse {
  /**
   * ID of the deleted render.
   */
  render_id: string;
}

/**
 * Output aspect ratio. Only the three ratios already supported end-to-end by
 * the render pipeline are exposed today: ``16:9`` (landscape), ``9:16``
 * (portrait), ``1:1`` (square). ``auto`` and other social-media ratios (4:5,
 * 5:4) are reserved for a follow-up PR that wires composition-dim inference at
 * the controller boundary.
 */
export type HyperframesAspectRatio = "16:9" | "9:16" | "1:1";

/**
 * Detailed HyperFrames render resource.
 */
export interface HyperframesRenderDetail {
  /**
   * Unique render identifier.
   */
  render_id: string;
  /**
   * Current lifecycle state.
   */
  status: HyperframesRenderStatus;
  /**
   * Caller-supplied free-text label.
   */
  title?: string | null;
  /**
   * Caller-supplied client tracking ID.
   */
  callback_id?: string | null;
  /**
   * Presigned download URL for the rendered video. Present only when status is
   * 'completed'.
   */
  video_url?: string | null;
  /**
   * Presigned download URL for the auto-generated thumbnail.
   */
  thumbnail_url?: string | null;
  /**
   * Video duration in seconds; null until completed.
   */
  duration?: number | null;
  /**
   * Frames per second the render was created at.
   */
  fps?: number | null;
  /**
   * Render quality preset.
   */
  quality?: "draft" | "standard" | "high" | null;
  /**
   * Output container/codec.
   */
  format: "mp4" | "webm" | "mov";
  /**
   * Resolution tier, if one was set.
   */
  resolution?: HyperframesResolution | null;
  /**
   * Aspect ratio, if one was set.
   */
  aspect_ratio?: HyperframesAspectRatio | null;
  /**
   * Composition entry file path.
   */
  composition?: string | null;
  /**
   * Unix timestamp when the render was created.
   */
  created_at?: number | null;
  /**
   * Unix timestamp when the render terminated. Null until status is 'completed'
   * or 'failed'.
   */
  completed_at?: number | null;
  /**
   * Error description. Present only when status is 'failed'.
   */
  failure_message?: string | null;
}

/**
 * Lifecycle status of a HyperFrames render.
 */
export type HyperframesRenderStatus = "queued" | "rendering" | "completed" | "failed";

/**
 * Output resolution tier. Pricing diverges only at 4K (1.5x multiplier). The
 * render-pipeline value set is intentionally narrow at launch; 720p and other
 * tiers will follow once the producer/CLI surface catches up.
 */
export type HyperframesResolution = "1080p" | "4k";

export interface StandardAPIError {
  /**
   * Machine-readable error code
   */
  code: string;
  /**
   * Human-readable error message
   */
  message: string;
  /**
   * Which request field caused the error
   */
  param?: string | null;
  /**
   * Link to error documentation
   */
  doc_url?: string | null;
}

/**
 * Response from uploading an asset via POST /v3/assets.
 */
export interface UploadAssetV3Response {
  /**
   * Unique asset identifier for use in other endpoints like POST
   * /v3/video-agents
   */
  asset_id: string;
  /**
   * Public URL of the uploaded asset
   */
  url: string;
  /**
   * Detected MIME type of the file
   */
  mime_type: string;
  /**
   * File size in bytes
   */
  size_bytes: number;
}
