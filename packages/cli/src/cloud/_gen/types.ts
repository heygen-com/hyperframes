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
   * HeyGen asset ID from an asset upload or import; not a third-party file ID.
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
   * Public http(s) URL HeyGen can download without auth or redirects. Not a
   * local or sandbox path (/mnt/data/..., file://, sandbox:); upload such files
   * and pass asset_id.
   */
  url: string;
}

export type AudioVoiceType = "public" | "private";

/**
 * How the avatar is scaled to the output canvas.
 */
export type AvatarFit = "contain" | "cover";

/**
 * Avatar III engine configuration. A single engine value that resolves to the
 * right product by the avatar's look type (mirrors how ``avatar_iv`` already
 * serves both photo and video avatars): - video avatar looks
 * (``digital_twin``, ``studio_avatar``) -> Digital Twin (supports 4K) -
 * ``photo_avatar`` look -> Photo Avatar (no 4K output) Not supported for raw
 * image input (``type: "image"``). ``motion_prompt`` and ``expressiveness``
 * are not supported with this engine.
 */
export interface AvatarIIIEngineConfig {
  /**
   * Engine type discriminator. Must be 'avatar_iii'. Resolves to Digital Twin
   * for video avatar looks (digital_twin, studio_avatar) and Photo Avatar for
   * photo_avatar looks; not supported for raw image input. Check
   * supported_api_engines on the avatar look to confirm eligibility.
   */
  type: "avatar_iii";
}

/**
 * Avatar IV engine configuration (default behavior).
 */
export interface AvatarIVEngineConfig {
  /**
   * Engine type discriminator. Must be 'avatar_iv'.
   */
  type: "avatar_iv";
}

/**
 * Avatar V engine configuration with cross-reference-driven animation.
 */
export interface AvatarVEngineConfig {
  /**
   * Engine type discriminator. Must be 'avatar_v'. Check supported_api_engines
   * on the avatar look to confirm eligibility.
   */
  type: "avatar_v";
  /**
   * Optional look to use as the animation reference. When provided, it must be a
   * `digital_twin` look accessible to your workspace and in the same avatar
   * group as `avatar_id` (`studio_avatar` and `photo_avatar` looks are
   * rejected). When omitted, video avatars self-reference and photo avatars
   * select from their group's eligible candidates, preferring digital twins
   * (ready first, then processing / upgrading), then curated public studio
   * looks. A photo avatar whose group has no eligible reference renders directly
   * from its image without one; motion_prompt is rejected in that case. A
   * non-public `digital_twin` reference, whether provided or selected
   * automatically, must also satisfy its group's consent requirements.
   */
  reference_look_id?: string | null;
  /**
   * Ask Avatar V for more natural blinking.
   */
  more_blinking?: boolean;
}

/**
 * A whole-frame speaking scene backed by an avatar.
 */
export interface AvatarVideoScene {
  /**
   * Must be 'avatar_video' for an avatar speaking scene.
   */
  type: "avatar_video";
  /**
   * Scene source ('type': 'avatar'): an avatar_id plus one audio source. The
   * avatar_id accepts any avatar look — video avatars and photo avatars alike
   * (pass a photo avatar's look id to get a talking photo). The scene duration
   * is derived server-side from the audio.
   */
  input: StudioAvatarInput;
}

export interface BackgroundRemovalJob {
  /**
   * Background removal job id. Use it to poll GET /v3/background-removals/{id}.
   */
  id: string;
  /**
   * Job status: 'pending' | 'processing' | 'completed' | 'failed' | 'deleted'.
   */
  status: string;
  /**
   * Map of produced layer name to a presigned download URL. Populated once
   * status is 'completed'.
   */
  layers?: Record<string, unknown>;
  /**
   * Processed video duration in seconds.
   */
  duration?: number | null;
  /**
   * Unix timestamp (seconds) when the job was created.
   */
  created_at?: number | null;
  /**
   * Unix timestamp (seconds) when the job completed. Present once completed.
   */
  completed_at?: number | null;
  /**
   * Failure reason. Present only when status is 'failed'.
   */
  error?: string | null;
}

/**
 * Background configuration for the generated video.
 */
export interface BackgroundSetting {
  /**
   * Background type. 'color' uses a solid hex color; 'image' uses an image from
   * url or asset_id.
   */
  type: "color" | "image";
  /**
   * Hex color code (e.g. '#ff0000'). Required when type is 'color'.
   */
  value?: string | null;
  /**
   * URL of the background image. Used when type is 'image'. Mutually exclusive
   * with asset_id.
   */
  url?: string | null;
  /**
   * HeyGen asset ID of the background image. Used when type is 'image'. Mutually
   * exclusive with url.
   */
  asset_id?: string | null;
}

/**
 * Supported caption file output formats.
 */
export type CaptionFileFormat = "srt";

/**
 * Caption generation settings for video creation. A sidecar subtitle file is
 * always generated and returned via ``subtitle_url`` in the chosen
 * ``file_format``. When ``style`` is also set, captions are additionally
 * burned into the rendered video — the sidecar is still delivered.
 */
export interface CaptionSetting {
  /**
   * Output format for the sidecar caption file.
   */
  file_format?: CaptionFileFormat;
  /**
   * Visual style for burning captions into the rendered video. Omit for
   * sidecar-only captions.
   */
  style?: CaptionStyle | null;
}

/**
 * Visual style applied when burning captions into the rendered video.
 */
export type CaptionStyle = "default";

/**
 * Video model that renders a Cinematic Avatar shot.
 */
export type CinematicAvatarModel = "seedance_2" | "heygen_video_1";

/**
 * Finalize a presigned upload (POST /v3/assets/{asset_id}/complete).
 */
export interface CompleteAssetUploadRequest {
  /**
   * Optional SHA256 (hex) cross-check.
   */
  checksum_sha256?: string | null;
}

/**
 * Result of finalizing an upload.
 */
export interface CompleteAssetUploadResponse {
  /**
   * The reusable asset identifier.
   */
  asset_id: string;
  /**
   * Public URL of the finalized asset.
   */
  url: string;
  /**
   * MIME type detected from the stored bytes.
   */
  mime_type: string;
  /**
   * Size of the stored object in bytes.
   */
  size_bytes: number;
  /**
   * Asset status, e.g. 'processing'.
   */
  status: "processing";
}

/**
 * Request to begin a presigned direct-to-S3 upload (POST
 * /v3/assets/direct-uploads).
 */
export interface CreateAssetUploadRequest {
  /**
   * Original filename for reference/metadata. The stored object's extension is
   * derived from content_type.
   */
  filename: string;
  /**
   * Declared MIME type (e.g. 'video/mp4', 'image/png', 'audio/mpeg',
   * 'application/pdf', 'application/zip'). Verified against the stored bytes at
   * completion.
   */
  content_type: string;
  /**
   * Exact byte size of the file. Signed into the upload URL so it cannot be
   * exceeded.
   */
  size_bytes: number;
  /**
   * Optional SHA256 of the file as hex. When provided, S3 enforces it on upload.
   */
  checksum_sha256?: string | null;
}

/**
 * Presigned upload instructions.
 */
export interface CreateAssetUploadResponse {
  /**
   * Reusable asset identifier. Becomes usable after POST
   * /v3/assets/{asset_id}/complete.
   */
  asset_id: string;
  /**
   * Presigned S3 URL. PUT the raw file bytes here.
   */
  upload_url: string;
  /**
   * Headers that must be sent verbatim on the PUT request.
   */
  upload_headers: Record<string, unknown>;
  /**
   * Seconds until the upload URL expires.
   */
  expires_in_seconds: number;
  /**
   * Maximum allowed upload size in bytes for this content type: 1.5 GB
   * (1,500,000,000 bytes) per audio file and 200 MiB (209,715,200 bytes) for
   * other supported files.
   */
  max_bytes: number;
  /**
   * Upload lifecycle status. Always 'pending_upload' here.
   */
  status: "pending_upload";
}

export interface CreateBackgroundRemovalRequest {
  /**
   * Input video to remove the background from (url, asset_id, or base64).
   */
  video: AssetUrl | AssetId | AssetBase64;
  /**
   * Output layers to return. Any of: 'foreground' (subject on a transparent
   * background), 'mask' (grayscale alpha matte), 'background' (the scene with
   * the subject removed). Defaults to all three.
   */
  layers?: Array<string>;
  /**
   * Optional human-readable title for the job.
   */
  title?: string | null;
  /**
   * Client-provided idempotency key — *the* idempotency mechanism for this
   * endpoint. Re-sending the same `request_id` returns the *original* job (same
   * `id`, same `status`, same charge) instead of creating a new one — the dedup
   * is over (`space_id`, `request_id`), not over the response body, so a
   * duplicate `request_id` with different content still collides on the original
   * job. The HTTP `Idempotency-Key` header is *not* honored here; pick a
   * per-content `request_id` if you need per-content dedup.
   */
  request_id?: string | null;
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
   * Overrides the quality preset's constant rate factor (lower is higher quality
   * and a larger file). Integer 0-51 for mp4, 0-63 for webm; ignored for mov.
   * Omit to use the preset's CRF.
   */
  crf?: number | null;
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
 * Request body for POST /v3/lipsyncs.
 */
export interface CreateLipsyncRequest {
  /**
   * Source video — provide as {type: 'url', url: '...'} or {type: 'asset_id',
   * asset_id: '...'}
   */
  video: AssetUrl | AssetId;
  /**
   * Replacement audio — provide as {type: 'url', url: '...'} or {type:
   * 'asset_id', asset_id: '...'}
   */
  audio: AssetUrl | AssetId;
  /**
   * Title for the lipsync job
   */
  title?: string | null;
  /**
   * Quality mode: 'speed' (faster) or 'precision' (higher quality, uses avatar
   * inference)
   */
  mode?: VideoTranslationMode;
  /**
   * Webhook URL for completion notifications
   */
  callback_url?: string | null;
  /**
   * ID included in webhook payload
   */
  callback_id?: string | null;
  /**
   * Deprecated and ignored: captions are always generated; whether to display
   * them is a download-side choice.
   */
  enable_caption?: boolean;
  /**
   * Preserve the source video's encoding specs (resolution, bitrate).
   */
  keep_the_same_format?: boolean | null;
  /**
   * Allow dynamic duration adjustment
   */
  enable_dynamic_duration?: boolean;
  /**
   * Remove background music
   */
  disable_music_track?: boolean;
  /**
   * Enhance speech quality
   */
  enable_speech_enhancement?: boolean;
  /**
   * Add watermark to output
   */
  enable_watermark?: boolean;
  /**
   * Start time in seconds for partial lipsync
   */
  start_time?: number | null;
  /**
   * End time in seconds for partial lipsync
   */
  end_time?: number | null;
  /**
   * Frame rate mode: 'vfr', 'cfr', or 'passthrough'.
   */
  fps_mode?: string | null;
  /**
   * Destination folder ID in the caller's workspace, for example one returned by
   * POST /v3/folders. Omit, pass null, or pass an empty string to place the
   * result at the workspace root. The id must name a folder that is not in the
   * trash and that the caller can write to. Assets library folders are accepted,
   * but the HeyGen app files only assets in them, so a result placed there may
   * not appear in the Assets library view. An unknown id, a folder in another
   * workspace, a project of another kind such as a brand kit, or a trashed
   * folder is rejected with 404 before anything is created.
   */
  folder_id?: string | null;
}

/**
 * Body of POST /v3/models/videos: one schema per generation mode, selected by
 * the required mode field.
 */
export type CreateModelVideoRequest =
  | TextToVideoRequest
  | ImageToVideoRequest
  | ReferenceToVideoRequest;

export interface CreateModelVideoResponse {
  /**
   * Video identifier to use when polling for the result.
   */
  video_id: string;
  /**
   * The request has been accepted for processing.
   */
  status?: "pending";
  /**
   * Total reference-video duration allocated for billing, in seconds, with a
   * shared 15-second budget.
   */
  input_video_duration?: number | null;
}

export interface CreateSpeechV3OutputFormat {
  /**
   * Audio encoding: mp3, or wav (signed little-endian PCM16).
   */
  encoding: "mp3" | "wav";
  /**
   * Sample rate in Hz: 8000, 16000, 22050, 24000, 44100, or 48000. Defaults to
   * 44100.
   */
  sample_rate_hertz?: number | null;
  /**
   * Bits per sample. wav accepts only 16, the default. Omit for mp3.
   */
  bit_depth?: number | null;
  /**
   * Number of audio channels. Only 1 (mono) is supported.
   */
  num_channels?: number;
  /**
   * MP3 bitrate in bits per second. Below 32000 Hz: 32000, 48000, or 64000
   * (default 64000). At 44100 or 48000 Hz: 64000, 96000, 128000, or 192000
   * (default 128000). Omit for wav.
   */
  bitrate_bps?: number | null;
}

export interface CreateSpeechV3Request {
  /**
   * Text to synthesize (1-5000 characters). Break tags must express time in
   * seconds (for example, <break time="0.35s"/>); millisecond values are not
   * supported.
   */
  text: string;
  /**
   * Voice ID from the voice catalog. Professional voice clones use model speech
   * generation instead.
   */
  voice_id: string;
  /**
   * Type of the input: 'text' for plain text, 'ssml' for SSML markup. Defaults
   * to 'text'.
   */
  input_type?: string;
  /**
   * Speed multiplier (0.5-2.0).
   */
  speed?: number;
  /**
   * Base language code (e.g. 'en', 'pt', 'zh'). Optional — auto-detected from
   * text when omitted.
   */
  language?: string | null;
  /**
   * Locale tag (e.g. 'zh-HK') for engines that support regional variants.
   * ElevenLabs does not support locale selection; use language instead.
   */
  locale?: string | null;
  /**
   * Bypass HeyGen's speech cache and request fresh synthesis. Normal speech
   * quota applies. Defaults to false.
   */
  force_regenerate?: boolean;
  /**
   * Speech engine override for this request only. Omit to use the voice's saved
   * default, including your saved preference. HeyGen Voice is the saved default
   * for most public voices. A missing or unsupported saved default, or an
   * unsupported override, returns an error; engines are never silently
   * substituted. Use 'heygen_voice' for HeyGen Voice; 'orca' remains accepted as
   * its legacy alias. Responses retain 'orca' for compatibility. ElevenLabs
   * model variants are selected through settings.model_id. The deprecated
   * elevenlabs_v3 input is accepted and runs as elevenlabs with the voice's
   * saved V3 model (eleven_v3 or eleven_v4) unless settings.model_id names one;
   * responses report elevenlabs.
   */
  engine?: "heygen_voice" | "starfish" | "orca" | "elevenlabs" | "elevenlabs_v3" | null;
  /**
   * Request-only ElevenLabs model settings. Applied after saved preferences;
   * valid for elevenlabs or the deprecated elevenlabs_v3 compatibility engine.
   */
  settings?: ElevenLabsSpeechSettings | null;
  /**
   * Brand glossary ID controlling how custom terms are pronounced in this speech
   * (for example, saying 'HeyGen' as 'hey-jen'). The glossary must belong to
   * your workspace. `word_timestamps` keep the original wording of `text`.
   * Discover IDs via GET /v3/brand-glossaries.
   */
  brand_glossary_id?: string | null;
  /**
   * Audio file format. Omit for an MP3 file at the speech engine's native sample
   * rate. With output_format, the audio_url file extension names the encoding.
   */
  output_format?: CreateSpeechV3OutputFormat | null;
}

export interface CreateSpeechV3ResponseData {
  /**
   * URL of the generated audio file.
   */
  audio_url: string;
  /**
   * Duration of the audio in seconds.
   */
  duration: number;
  /**
   * Unique identifier for this generation request.
   */
  request_id?: string | null;
  /**
   * Word-level timing data.
   */
  word_timestamps?: Array<WordWithTimestamp> | null;
  /**
   * Engine selected for this speech generation.
   */
  engine: SpeechEngine;
}

/**
 * Create a video from a HeyGen avatar (video or photo avatar). Provide an
 * avatar_id to use a previously created avatar. Supports all avatar types:
 * studio_avatar, digital_twin, and photo_avatar. Optionally set ``engine`` to
 * select Avatar V for eligible avatars; when omitted, the server defaults to
 * Avatar IV.
 */
export interface CreateVideoFromAvatar {
  /**
   * Display title for the video in the HeyGen dashboard.
   */
  title?: string | null;
  /**
   * Destination folder ID in the caller's workspace, for example one returned by
   * POST /v3/folders. Omit, pass null, or pass an empty string to place the
   * result at the workspace root. The id must name a folder that is not in the
   * trash and that the caller can write to. Assets library folders are accepted,
   * but the HeyGen app files only assets in them, so a result placed there may
   * not appear in the Assets library view. An unknown id, a folder in another
   * workspace, a project of another kind such as a brand kit, or a trashed
   * folder is rejected with 404 before anything is created. Supported only for
   * single-video creation; batch video items cannot set their own destination
   * folder.
   */
  folder_id?: string | null;
  /**
   * Output video resolution. Defaults to 720p. `4k` is available for Avatar III
   * digital twins and studio avatars. For apps signed in with OAuth, such as MCP
   * clients, the account's plan sets the maximum: 720p on Free, 1080p on
   * Creator.
   */
  resolution?: VideoResolution | null;
  /**
   * Output video aspect ratio. Supported values: '16:9', '9:16', '4:5', '5:4',
   * '1:1', 'auto'. Defaults to '16:9'. 'auto' preserves the source's aspect
   * ratio (avatar source frames or uploaded image), short-edge anchored to the
   * requested resolution and capped at the tier's long edge. Falls back to
   * '16:9' when source dimensions can't be read.
   */
  aspect_ratio?: VideoAspectRatio | null;
  /**
   * How the subject is fitted to the output canvas. 'cover' scales to fill the
   * frame (may crop edges). 'contain' scales to fit entirely within the frame
   * (may show background). When omitted, the server picks the best option based
   * on the source and canvas orientations.
   */
  fit?: AvatarFit | null;
  /**
   * Background settings for the video.
   */
  background?: BackgroundSetting | null;
  /**
   * Remove the avatar background. Video avatars must be trained with matting
   * enabled.
   */
  remove_background?: boolean | null;
  /**
   * Webhook URL to receive a POST notification when the video is ready.
   */
  callback_url?: string | null;
  /**
   * Caller-defined identifier echoed back in the webhook payload.
   */
  callback_id?: string | null;
  /**
   * Custom watermark image to overlay on the video (PNG or JPEG). Available to
   * workspaces on an Enterprise web or API plan.
   */
  watermark?: WatermarkInput | null;
  /**
   * Caption generation settings. A sidecar subtitle file is always returned via
   * subtitle_url; set 'style' to additionally burn captions into the rendered
   * video.
   */
  caption?: CaptionSetting | null;
  /**
   * Output container. 'webm' returns a video with a transparent background
   * (alpha channel); 'mp4' (default) returns a standard video. 'webm' requires
   * an avatar that supports matting. When 'webm' is selected, any 'background'
   * value is rejected and background removal is applied automatically — the
   * caller does not need to set 'remove_background'.
   */
  output_format?: VideoOutputFormat;
  /**
   * Text script for the avatar to speak. Pair with voice_id, or omit voice_id
   * when using avatar_id to use the avatar's default voice. Mutually exclusive
   * with audio_url/audio_asset_id.
   */
  script?: string | null;
  /**
   * Voice ID for text-to-speech. Required when script is provided, unless
   * avatar_id is set (the avatar's default voice is used as fallback).
   */
  voice_id?: string | null;
  /**
   * Public http(s) URL of an audio file to lip-sync. Mutually exclusive with
   * script. Not a local or sandbox path (/mnt/data/..., file://); upload it and
   * pass audio_asset_id.
   */
  audio_url?: string | null;
  /**
   * HeyGen asset ID of an uploaded audio file. Mutually exclusive with script.
   */
  audio_asset_id?: string | null;
  /**
   * Voice tuning parameters (speed, pitch, locale).
   */
  voice_settings?: VoiceSettingsInput | null;
  /**
   * Must be 'avatar' for avatar-based video creation.
   */
  type: "avatar";
  /**
   * HeyGen avatar ID (video avatar or photo avatar look ID).
   */
  avatar_id: string;
  /**
   * Brand glossary ID controlling how custom terms are pronounced in generated
   * speech (for example, saying 'HeyGen' as 'hey-jen'). Applies when the audio
   * is synthesized from `script`; a caller-supplied `audio_url` or
   * `audio_asset_id` is unaffected. Pronunciation is applied to the synthesized
   * audio only, so caption and subtitle text still show the original script
   * wording. Discover IDs via GET /v3/brand-glossaries.
   */
  brand_glossary_id?: string | null;
  /**
   * Natural-language prompt controlling avatar body motion and hand gestures.
   * Supported for photo avatars on either engine, and for video avatars when
   * engine.type is 'avatar_v'. Rejected for video avatars on the default Avatar
   * IV engine, and for photo avatars on 'avatar_v' when the avatar's group has
   * no animation reference (no digital twin or curated reference look).
   */
  motion_prompt?: string | null;
  /**
   * Avatar expressiveness level. Photo avatars only. Defaults to 'low' when
   * omitted. Avatar IV only; rejected when engine.type is 'avatar_v'.
   */
  expressiveness?: Expressiveness | null;
  /**
   * Engine configuration for video generation. Pass {"type": "avatar_v"} to
   * enable cross-reference-driven animation for higher quality. Check
   * supported_api_engines on the avatar look to confirm eligibility. Defaults to
   * Avatar IV when omitted.
   */
  engine?: AvatarVEngineConfig | AvatarIVEngineConfig | AvatarIIIEngineConfig | null;
}

/**
 * Create a video from a text prompt plus avatar and asset references
 * (Cinematic Avatar). Cinematic Avatar generates a video from a
 * natural-language ``prompt`` guided by reference content: one to three avatar
 * looks and optional reference assets (images / videos / audio). Unlike the
 * ``avatar`` and ``image`` modes there is no script or voice — motion and
 * speech are driven entirely by the prompt and the supplied references. The
 * video model is chosen with ``model``.
 */
export interface CreateVideoFromCinematicAvatar {
  /**
   * Must be 'cinematic_avatar' for prompt-and-reference video creation.
   */
  type: "cinematic_avatar";
  /**
   * Natural-language prompt describing the video to generate.
   */
  prompt: string;
  /**
   * Avatar look ID(s) used as visual references. Provide 1 to 3 look IDs.
   */
  avatar_id: Array<string>;
  /**
   * Video model that renders the shot. Omitted means 'seedance_2'. 'seedance_2'
   * supports every aspect_ratio and resolution below and is billed a flat price
   * per shot by resolution. 'heygen_video_1' renders 16:9 or 9:16 at 720p, 5–15
   * seconds long, and is billed per second of output plus reference video, each
   * reference video counting at most its first 5 seconds; it accepts each
   * reference asset_id once.
   */
  model?: CinematicAvatarModel | null;
  /**
   * Reference assets (images, videos, or audio) guiding the generation. Each
   * accepts a URL, an asset_id, or inline base64. Combined limits: at most 3
   * videos and 9 images across avatars and references. 'heygen_video_1' also
   * accepts at most 3 audio clips (avatar voices included), 12 references in
   * total, and 15 seconds of reference video, each avatar counting 3 seconds.
   */
  references?: Array<AssetUrl | AssetId | AssetBase64> | null;
  /**
   * Output aspect ratio. Supported for cinematic_avatar: '16:9', '9:16', '1:1'
   * ('heygen_video_1': '16:9', '9:16'). Defaults to '16:9'.
   */
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  /**
   * Output resolution. Supported for cinematic_avatar: '720p', '1080p'
   * ('heygen_video_1': '720p'). Defaults to '720p'.
   */
  resolution?: "720p" | "1080p";
  /**
   * Renders the 10-second default with either model, the same as omitting
   * duration. When true, omit duration.
   */
  auto_duration?: boolean;
  /**
   * Video length in seconds (4–15; 5–15 for 'heygen_video_1'). Defaults to 10.
   * Omit when auto_duration is true.
   */
  duration?: number | null;
  /**
   * Enable server-side prompt enhancement.
   */
  enhance_prompt?: boolean;
  /**
   * Display title for the video in the HeyGen dashboard.
   */
  title?: string | null;
  /**
   * Destination folder ID in the caller's workspace, for example one returned by
   * POST /v3/folders. Omit, pass null, or pass an empty string to place the
   * result at the workspace root. The id must name a folder that is not in the
   * trash and that the caller can write to. Assets library folders are accepted,
   * but the HeyGen app files only assets in them, so a result placed there may
   * not appear in the Assets library view. An unknown id, a folder in another
   * workspace, a project of another kind such as a brand kit, or a trashed
   * folder is rejected with 404 before anything is created. Supported only for
   * single-video creation; batch video items cannot set their own destination
   * folder.
   */
  folder_id?: string | null;
}

/**
 * Create a lip-synced video from an image of a person. The image must show a
 * clearly visible, human-like face: a photo, or a realistic illustration of a
 * person. Images without a detectable face are rejected with 400. For
 * non-human or stylized characters (mascots, animals, objects), use the
 * image_to_video or reference_to_video mode of POST /v3/models/videos instead.
 * Provide an image via URL, asset ID, or inline base64. The image will be
 * animated with lip-sync to the provided audio or generated speech.
 */
export interface CreateVideoFromImage {
  /**
   * Display title for the video in the HeyGen dashboard.
   */
  title?: string | null;
  /**
   * Destination folder ID in the caller's workspace, for example one returned by
   * POST /v3/folders. Omit, pass null, or pass an empty string to place the
   * result at the workspace root. The id must name a folder that is not in the
   * trash and that the caller can write to. Assets library folders are accepted,
   * but the HeyGen app files only assets in them, so a result placed there may
   * not appear in the Assets library view. An unknown id, a folder in another
   * workspace, a project of another kind such as a brand kit, or a trashed
   * folder is rejected with 404 before anything is created. Supported only for
   * single-video creation; batch video items cannot set their own destination
   * folder.
   */
  folder_id?: string | null;
  /**
   * Output video resolution. Defaults to 720p. `4k` is available for Avatar III
   * digital twins and studio avatars. For apps signed in with OAuth, such as MCP
   * clients, the account's plan sets the maximum: 720p on Free, 1080p on
   * Creator.
   */
  resolution?: VideoResolution | null;
  /**
   * Output video aspect ratio. Supported values: '16:9', '9:16', '4:5', '5:4',
   * '1:1', 'auto'. Defaults to '16:9'. 'auto' preserves the source's aspect
   * ratio (avatar source frames or uploaded image), short-edge anchored to the
   * requested resolution and capped at the tier's long edge. Falls back to
   * '16:9' when source dimensions can't be read.
   */
  aspect_ratio?: VideoAspectRatio | null;
  /**
   * How the subject is fitted to the output canvas. 'cover' scales to fill the
   * frame (may crop edges). 'contain' scales to fit entirely within the frame
   * (may show background). When omitted, the server picks the best option based
   * on the source and canvas orientations.
   */
  fit?: AvatarFit | null;
  /**
   * Background settings for the video.
   */
  background?: BackgroundSetting | null;
  /**
   * Remove the avatar background. Video avatars must be trained with matting
   * enabled.
   */
  remove_background?: boolean | null;
  /**
   * Webhook URL to receive a POST notification when the video is ready.
   */
  callback_url?: string | null;
  /**
   * Caller-defined identifier echoed back in the webhook payload.
   */
  callback_id?: string | null;
  /**
   * Custom watermark image to overlay on the video (PNG or JPEG). Available to
   * workspaces on an Enterprise web or API plan.
   */
  watermark?: WatermarkInput | null;
  /**
   * Caption generation settings. A sidecar subtitle file is always returned via
   * subtitle_url; set 'style' to additionally burn captions into the rendered
   * video.
   */
  caption?: CaptionSetting | null;
  /**
   * Output container. 'webm' returns a video with a transparent background
   * (alpha channel); 'mp4' (default) returns a standard video. 'webm' requires
   * an avatar that supports matting. When 'webm' is selected, any 'background'
   * value is rejected and background removal is applied automatically — the
   * caller does not need to set 'remove_background'.
   */
  output_format?: VideoOutputFormat;
  /**
   * Text script for the avatar to speak. Pair with voice_id, or omit voice_id
   * when using avatar_id to use the avatar's default voice. Mutually exclusive
   * with audio_url/audio_asset_id.
   */
  script?: string | null;
  /**
   * Voice ID for text-to-speech. Required when script is provided, unless
   * avatar_id is set (the avatar's default voice is used as fallback).
   */
  voice_id?: string | null;
  /**
   * Public http(s) URL of an audio file to lip-sync. Mutually exclusive with
   * script. Not a local or sandbox path (/mnt/data/..., file://); upload it and
   * pass audio_asset_id.
   */
  audio_url?: string | null;
  /**
   * HeyGen asset ID of an uploaded audio file. Mutually exclusive with script.
   */
  audio_asset_id?: string | null;
  /**
   * Voice tuning parameters (speed, pitch, locale).
   */
  voice_settings?: VoiceSettingsInput | null;
  /**
   * Must be 'image' for image-based video creation.
   */
  type: "image";
  /**
   * Image to animate. Accepts URL, asset ID, or base64-encoded data.
   */
  image: AssetUrl | AssetId | AssetBase64;
  /**
   * Brand glossary ID controlling how custom terms are pronounced in generated
   * speech (for example, saying 'HeyGen' as 'hey-jen'). Applies when the audio
   * is synthesized from `script`; a caller-supplied `audio_url` or
   * `audio_asset_id` is unaffected. Pronunciation is applied to the synthesized
   * audio only, so caption and subtitle text still show the original script
   * wording. Discover IDs via GET /v3/brand-glossaries.
   */
  brand_glossary_id?: string | null;
  /**
   * Natural-language prompt controlling avatar body motion. Photo avatars only.
   */
  motion_prompt?: string | null;
  /**
   * Avatar expressiveness level. Photo avatars only. Defaults to 'low' when
   * omitted.
   */
  expressiveness?: Expressiveness | null;
}

/**
 * Create a single video by composing an ordered list of whole-frame scenes.
 * The server owns layout and center-crops each scene to the global output
 * canvas. Output settings are global (one per request); a single video_id is
 * returned and rendering is all-or-nothing. MP4 only in v1 — the output
 * container is fixed and ``output_format`` is not exposed.
 */
export interface CreateVideoFromStudio {
  /**
   * Must be 'studio' for scene-composition video creation.
   */
  type: "studio";
  /**
   * Display title for the video in the HeyGen dashboard.
   */
  title?: string | null;
  /**
   * Destination folder ID in the caller's workspace, for example one returned by
   * POST /v3/folders. Omit, pass null, or pass an empty string to place the
   * result at the workspace root. The id must name a folder that is not in the
   * trash and that the caller can write to. Assets library folders are accepted,
   * but the HeyGen app files only assets in them, so a result placed there may
   * not appear in the Assets library view. An unknown id, a folder in another
   * workspace, a project of another kind such as a brand kit, or a trashed
   * folder is rejected with 404 before anything is created. Supported only for
   * single-video creation; batch video items cannot set their own destination
   * folder.
   */
  folder_id?: string | null;
  /**
   * Global output aspect ratio. Supported values: '16:9', '9:16', '4:5', '5:4',
   * '1:1', 'auto'. Defaults to '16:9'. Each scene is center-cropped to this
   * canvas.
   */
  aspect_ratio?: VideoAspectRatio | null;
  /**
   * Global output video resolution. Defaults to 1080p. `4k` is available for
   * Avatar III digital twins and studio avatars. For apps signed in with OAuth,
   * such as MCP clients, the account's plan sets the maximum: 720p on Free,
   * 1080p on Creator.
   */
  resolution?: VideoResolution | null;
  /**
   * Brand glossary ID controlling how custom terms are pronounced in generated
   * speech (for example, saying 'HeyGen' as 'hey-jen'). Applies to every scene
   * whose audio is synthesized from a script; scenes that supply their own audio
   * URL or audio asset are unaffected. Pronunciation is applied to the
   * synthesized audio only, so caption and subtitle text still show the original
   * script wording. Discover IDs via GET /v3/brand-glossaries.
   */
  brand_glossary_id?: string | null;
  /**
   * Webhook URL to receive a POST notification when the video is ready.
   */
  callback_url?: string | null;
  /**
   * Caller-defined identifier echoed back in the webhook payload.
   */
  callback_id?: string | null;
  /**
   * Caption generation settings. A sidecar subtitle file is always returned via
   * subtitle_url; set 'style' to additionally burn captions into the rendered
   * video.
   */
  caption?: CaptionSetting | null;
  /**
   * Custom watermark image to overlay on the video (PNG or JPEG). Available to
   * workspaces on an Enterprise web or API plan.
   */
  watermark?: WatermarkInput | null;
  /**
   * Ordered list of whole-frame scenes to concatenate. Each scene is one of
   * 'avatar_video', 'image', or 'video'. Must contain 1 to 50 scenes.
   */
  scenes: Array<AvatarVideoScene | ImageScene | VideoScene>;
}

/**
 * Discriminated union for POST /v3/videos request body.
 */
export type CreateVideoV3RequestBody =
  | CreateVideoFromAvatar
  | CreateVideoFromImage
  | CreateVideoFromCinematicAvatar
  | CreateVideoFromStudio;

/**
 * POST /v3/videos response.
 */
export interface CreateVideoV3Response {
  /**
   * Unique identifier for the created video.
   */
  video_id: string;
  /**
   * Initial video status (e.g. 'waiting').
   */
  status: string;
  /**
   * Resolved output format for the video.
   */
  output_format?: VideoOutputFormat;
  /**
   * Resolution the video renders at. Null for Avatar VI; absent for cinematic
   * avatar videos.
   */
  resolution?: VideoResolution | null;
  /**
   * Set when the video renders at a lower resolution than requested because the
   * account's plan caps it, worded to pass on to the user.
   */
  resolution_note?: string | null;
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
 * Engine-specific voice settings for ElevenLabs-backed voices. Supports model,
 * stability, similarity_boost, style, and use_speaker_boost. When using
 * eleven_v3 or eleven_v4, stability may be any value in [0.0, 1.0].
 */
export interface ElevenLabsEngineSettings {
  /**
   * The model ID to use for ElevenLabs.
   */
  model?: ElevenLabsModel | null;
  /**
   * The similarity boost parameter for ElevenLabs.
   */
  similarity_boost?: number | null;
  /**
   * The stability parameter for ElevenLabs.
   */
  stability?: number | null;
  /**
   * The style parameter for ElevenLabs.
   */
  style?: number | null;
  /**
   * Whether to use speaker boost for ElevenLabs.
   */
  use_speaker_boost?: boolean | null;
  /**
   * Engine type discriminator. Must be 'elevenlabs' for ElevenLabs-backed
   * voices.
   */
  engine_type: "elevenlabs";
}

/**
 * ElevenLabs model IDs exposed on the public API. Only current models are
 * included — deprecated models (monolingual_v1, multilingual_v1, turbo_v2) are
 * not accepted.
 */
export type ElevenLabsModel =
  | "eleven_multilingual_v2"
  | "eleven_turbo_v2_5"
  | "eleven_flash_v2_5"
  | "eleven_v3"
  | "eleven_v4";

export interface ElevenLabsSpeechSettings {
  /**
   * ElevenLabs model for this request only. Omit settings to retain the voice's
   * saved model preference.
   */
  model_id:
    | "eleven_multilingual_v2"
    | "eleven_flash_v2"
    | "eleven_flash_v2_5"
    | "eleven_turbo_v2_5"
    | "eleven_v3"
    | "eleven_v4";
}

/**
 * Avatar expressiveness level for photo avatars.
 */
export type Expressiveness = "high" | "medium" | "low";

/**
 * Engine-specific voice settings for Fish Audio-backed voices. Inherits Fish's
 * tuning fields (model, stability, similarity).
 */
export interface FishEngineSettings {
  /**
   * Fish Audio model version (default 's2.1-pro'). 's1' is deprecated and is
   * retired on 2026-11-15; use 's2.1-pro'.
   */
  model?: FishModel | null;
  /**
   * Stability parameter; higher is more consistent.
   */
  stability?: number | null;
  /**
   * Similarity parameter; how closely to match the source voice.
   */
  similarity?: number | null;
  /**
   * Engine type discriminator. Must be 'fish' for Fish Audio-backed voices.
   */
  engine_type: "fish";
}

/**
 * Fish Audio model version.
 */
export type FishModel = "s1" | "s2-pro" | "s2.1-pro";

/**
 * GPT Image 2.5.
 */
export interface GptImage25Request {
  model: "gpt-image-2.5";
  /**
   * What to generate, or how to edit the reference images.
   */
  prompt: string;
  /**
   * Number of images to generate, from 1 to 4.
   */
  num_images?: number;
  /**
   * Output aspect ratio. 16:9 when omitted.
   */
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | null;
  /**
   * Reference images. When non-empty the request is an edit.
   */
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

/**
 * Selects HeyGen Voice, including instant and professional clones; no tunable
 * fields. A script in a language HeyGen Voice does not speak renders with
 * ElevenLabs instead when the voice can use ElevenLabs; otherwise the video
 * fails.
 */
export interface HeyGenVoiceEngineSettings {
  /**
   * Engine type discriminator. 'heygen_voice' selects HeyGen Voice; 'orca' is
   * accepted as its legacy alias.
   */
  engine_type: "heygen_voice" | "orca";
}

/**
 * Output aspect ratio. Supported ratios are ``16:9`` (landscape), ``9:16``
 * (portrait), and ``1:1`` (square).
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
  /**
   * Why billing refused a finished render: 'hf_usage_exhausted',
   * 'hf_subscription_required' or 'api_key_required', for which nothing was
   * charged and the render can be sent again on a HeyGen API key; or
   * 'usage_limit_reached', when a usage limit a workspace admin set (the API
   * key's credit limit or the member's usage limit) was reached; sending the
   * render again does not help until the limit is raised or resets, and
   * `failure_message` is the limit's own message; or
   * 'chunk_frames_exceed_timeout_at_max_chunks', when the render is too long to
   * export at its size (even split into the most cloud parts allowed, it would
   * still take longer than the time limit): sending it again fails the same way
   * until it is shortened or rendered at a lower resolution or frame rate, and
   * `failure_message` says so. Present only when status is 'failed' for one of
   * these reasons.
   */
  failure_code?: string | null;
}

/**
 * Lifecycle status of a HyperFrames render.
 */
export type HyperframesRenderStatus = "queued" | "rendering" | "completed" | "failed";

/**
 * Output resolution tier. 4K output uses a 1.5x pricing multiplier.
 */
export type HyperframesResolution = "1080p" | "4k";

export type ImageCreateRequest = GptImage25Request | NanoBanana2Request | NanoBanana21Request;

/**
 * A whole-frame still-image scene: either silent (held for ``duration``) or
 * narrated. Exactly one mode must be chosen: - silent: set ``duration``
 * (seconds) and no audio source. - narrated: set exactly one audio source
 * (script + voice_id, audio_url, or audio_asset_id) and omit ``duration`` —
 * the scene length follows the audio.
 */
export interface ImageScene {
  /**
   * Must be 'image' for a still-image scene.
   */
  type: "image";
  /**
   * Still image to display. Accepts URL, asset ID, or base64-encoded data.
   */
  source: AssetUrl | AssetId | AssetBase64;
  /**
   * Silent mode: hold the still image for this many seconds. Mutually exclusive
   * with any audio source. Must be > 0 and <= 300.
   */
  duration?: number | null;
  /**
   * Narrated mode: text to speak over the image. Pair with voice_id. Mutually
   * exclusive with duration/audio_url/audio_asset_id.
   */
  script?: string | null;
  /**
   * Voice ID for text-to-speech. Required when script is provided.
   */
  voice_id?: string | null;
  /**
   * Narrated mode: public http(s) URL of an audio file to play over the image.
   * Mutually exclusive with duration/script. Not a local or sandbox path
   * (/mnt/data/..., file://); upload it and pass audio_asset_id.
   */
  audio_url?: string | null;
  /**
   * Narrated mode: HeyGen asset ID of an uploaded audio file. Mutually exclusive
   * with duration/script.
   */
  audio_asset_id?: string | null;
  /**
   * Voice tuning parameters (speed, pitch, locale).
   */
  voice_settings?: VoiceSettingsInput | null;
}

export interface ImageToVideoRequest {
  /**
   * Stable, opaque end-user identifier in your application, scoped to the
   * authenticated workspace. Use 1–128 non-whitespace characters without
   * personal information. Used for usage attribution and abuse investigation;
   * does not change billing, authorization, or rate limits.
   */
  end_user_id?: string | null;
  /**
   * Animate a first-frame image.
   */
  mode: "image_to_video";
  /**
   * Required video generation model. Only heygen-video-1 is supported.
   */
  model: "heygen-video-1";
  /**
   * Instructions for the video to generate. At most 16,000 Unicode characters.
   */
  prompt: string;
  /**
   * Prompt enhancement mode: turbo, quality, ultraquality, or disabled. Defaults
   * to quality; default is an alias for turbo.
   */
  prompt_enhancement?: "turbo" | "quality" | "default" | "disabled" | "ultraquality";
  /**
   * Output resolution: 480p, 768p, 1080p, or 2k. Defaults to 768p. At 1080p and
   * 2k, text-to-video and reference-to-video require aspect_ratio 16:9 or 9:16;
   * image-to-video follows the image proportions.
   */
  resolution?: "480p" | "768p" | "1080p" | "2k";
  /**
   * Requested video duration: whole seconds from 5 through 30, or auto. Defaults
   * to 5 when omitted. Above 15 requires text_to_video or image_to_video,
   * 480p/768p/1080p/2k, and turbo/default/quality enhancement. Auto estimates
   * quoted speech with an 8-second minimum and the maximum supported by these
   * settings. Generation and billing use the resolved duration.
   */
  duration?: number | "auto";
  /**
   * The output follows the image proportions, aligned to supported pixel
   * dimensions. Any supplied aspect ratio is ignored.
   */
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "adaptive" | null;
  /**
   * Generation seed. A random seed is chosen when omitted.
   */
  seed?: number | null;
  /**
   * HTTPS webhook URL for the terminal generation event.
   */
  callback_url?: string | null;
  /**
   * Client tracking ID echoed in the terminal webhook event.
   */
  callback_id?: string | null;
  /**
   * First-frame image.
   */
  image: AssetUrl | AssetId | AssetBase64;
  /**
   * Optional image to guide the last frame. Requires image as the first frame;
   * the output proportions still follow image.
   */
  end_image?: AssetUrl | AssetId | AssetBase64 | null;
}

/**
 * Response for POST /v3/lipsyncs.
 */
export interface LipsyncCreateResponse {
  /**
   * Lipsync ID — use GET /v3/lipsyncs/{id} to poll status
   */
  lipsync_id: string;
}

/**
 * Detailed lipsync resource.
 */
export interface LipsyncDetail {
  /**
   * Unique lipsync identifier
   */
  id: string;
  /**
   * Title of the lipsync job
   */
  title?: string | null;
  /**
   * Current status
   */
  status: VideoTranslationStatus;
  /**
   * Video duration in seconds
   */
  duration?: number | null;
  /**
   * Presigned download URL for the output video. Only present when status is
   * completed.
   */
  video_url?: string | null;
  /**
   * Presigned download URL for the SRT caption file. Only present when
   * completed.
   */
  caption_url?: string | null;
  /**
   * Client-provided callback ID
   */
  callback_id?: string | null;
  /**
   * Unix timestamp when the lipsync was created
   */
  created_at?: number | null;
  /**
   * Error description. Only present when status is failed.
   */
  failure_message?: string | null;
  /**
   * Machine-readable failure reason. Only present when status is failed and the
   * failure has a code.
   */
  failure_code?: string | null;
}

export interface LyriaMusicRequest {
  /**
   * Music model. Each model accepts its own options.
   */
  model: "lyria-3-pro";
  /**
   * What the track should sound like: genre, mood, instruments, use.
   */
  prompt: string;
  /**
   * Target length: 30, 60, 120 or 180. A longer render is cut to this length
   * with a fade-out; a shorter one is kept as is.
   */
  duration_seconds: number;
  /**
   * Target tempo in beats per minute.
   */
  bpm?: number | null;
  /**
   * Energy from 1 (ambient) to 5 (peak).
   */
  intensity?: number | null;
  /**
   * No vocals. Cannot be combined with `lyrics`.
   */
  instrumental?: boolean;
  /**
   * Lyrics to sing verbatim. Untagged text is split into verses on blank lines.
   * Written by the model when omitted.
   */
  lyrics?: string | null;
}

export interface ModelVideoResponse {
  /**
   * Generated video identifier.
   */
  video_id: string;
  /**
   * Current generation status.
   */
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  /**
   * Requested video generation model.
   */
  model: VideoGenerationModel;
  /**
   * Request creation time as Unix seconds.
   */
  created_at: number;
  /**
   * Download URL, present when completed. Poll again to obtain a fresh URL.
   */
  video_url?: string | null;
  /**
   * Generated video duration in seconds, present when completed.
   */
  duration?: number | null;
  /**
   * Total reference-video duration allocated for billing, in seconds, with a
   * shared 15-second budget.
   */
  input_video_duration?: number | null;
  /**
   * Output aspect ratio. Adaptive outputs report the actual width:height ratio
   * after pixel alignment.
   */
  aspect_ratio?: string | null;
  /**
   * Actual output width in pixels, present when reported by the renderer.
   */
  width?: number | null;
  /**
   * Actual output height in pixels, present when reported by the renderer.
   */
  height?: number | null;
  /**
   * Generation seed, present when completed.
   */
  seed?: number | null;
  /**
   * Generation timing in seconds, when reported by the renderer.
   */
  timings?: ModelVideoTimings | null;
  /**
   * Failure code, present when failed or cancelled. `usage_limit_reached` means
   * the charge was refused because a usage limit a workspace admin set (the API
   * key's credit limit or the member's usage limit) was reached;
   * `failure_message` is the limit's own message.
   */
  failure_code?: "generation_failed" | "generation_cancelled" | "usage_limit_reached" | null;
  /**
   * Failure explanation, present when failed or cancelled.
   */
  failure_message?: string | null;
}

export interface ModelVideoTimings {
  /**
   * Diffusion transformer execution time in seconds. Excludes other inference
   * stages, encoding, and queueing.
   */
  inference: number;
}

/**
 * Discriminated union for POST /v3/audio/music request body, keyed on `model`.
 */
export type MusicCreateRequest = LyriaMusicRequest;

export type MusicFailureCode =
  | "invalid_input"
  | "content_policy_violation"
  | "vendor_unavailable"
  | "vendor_timeout"
  | "ai_vendor_access_restricted"
  | "insufficient_credit"
  | "api_key_required"
  | "internal_error";

export interface MusicResponse {
  /**
   * The music job id; read it again with GET /v3/audio/music/{id}.
   */
  id: string;
  /**
   * `completed` or `failed`; `pending` only while the creating request is still
   * running.
   */
  status: MusicStatus;
  /**
   * The music model that generated the track.
   */
  model: "lyria-3-pro";
  /**
   * Unix seconds.
   */
  created_at?: number | null;
  /**
   * The target length the request asked for.
   */
  requested_duration_seconds: number;
  /**
   * The measured length of the file; present once completed.
   */
  duration_seconds?: number | null;
  /**
   * Time-limited download URL of the mp3; present once completed. Read the job
   * again for a fresh URL.
   */
  audio_url?: string | null;
  /**
   * Audio format; present once completed.
   */
  format?: "mp3" | null;
  /**
   * Why the job failed; present once failed.
   */
  failure_code?: MusicFailureCode | null;
  /**
   * A customer-safe explanation; present once failed.
   */
  failure_message?: string | null;
}

export type MusicStatus = "pending" | "completed" | "failed";

/**
 * Nano Banana 2.1.
 */
export interface NanoBanana21Request {
  model: "nano-banana-2.1";
  /**
   * What to generate, or how to edit the reference images.
   */
  prompt: string;
  /**
   * Number of images to generate, from 1 to 4.
   */
  num_images?: number;
  /**
   * Output aspect ratio. 16:9 when omitted.
   */
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | null;
  /**
   * Reference images. When non-empty the request is an edit.
   */
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

/**
 * Nano Banana 2 (Gemini 3.1 Flash Image).
 */
export interface NanoBanana2Request {
  model: "nano-banana-2";
  /**
   * What to generate, or how to edit the reference images.
   */
  prompt: string;
  /**
   * Number of images to generate, from 1 to 4.
   */
  num_images?: number;
  /**
   * Output aspect ratio. 16:9 when omitted.
   */
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | null;
  /**
   * Reference images. When non-empty the request is an edit.
   */
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

/**
 * Playback and audio capability for a video-clip scene. ``mode`` controls how
 * a narrated clip is reconciled to the voiceover-driven scene duration.
 * ``volume`` must be between 0.0 and 1.0.
 */
export interface PlaybackInput {
  /**
   * How a narrated clip aligns to the voiceover-driven scene duration. 'freeze'
   * plays once and holds the last frame; 'loop' repeats the clip; 'fit_to_scene'
   * adjusts playback speed to exactly match the scene. Defaults to 'freeze' when
   * omitted. Requires a video-scene voiceover.
   */
  mode?: "freeze" | "loop" | "fit_to_scene" | null;
  /**
   * Clip audio volume. 1.0 = source level (default), 0.0 = silent.
   */
  volume?: number;
  /**
   * If True, force the clip silent regardless of 'volume'.
   */
  mute?: boolean;
}

export interface ReferenceToVideoRequest {
  /**
   * Stable, opaque end-user identifier in your application, scoped to the
   * authenticated workspace. Use 1–128 non-whitespace characters without
   * personal information. Used for usage attribution and abuse investigation;
   * does not change billing, authorization, or rate limits.
   */
  end_user_id?: string | null;
  /**
   * Generate guided by reference images, videos, and audio.
   */
  mode: "reference_to_video";
  /**
   * Required video generation model. Only heygen-video-1 is supported.
   */
  model: "heygen-video-1";
  /**
   * Instructions for the video to generate. At most 16,000 Unicode characters.
   */
  prompt: string;
  /**
   * Prompt enhancement mode: turbo, quality, ultraquality, or disabled. Defaults
   * to quality; default is an alias for turbo.
   */
  prompt_enhancement?: "turbo" | "quality" | "default" | "disabled" | "ultraquality";
  /**
   * Output resolution: 480p, 768p, 1080p, or 2k. Defaults to 768p. At 1080p and
   * 2k, text-to-video and reference-to-video require aspect_ratio 16:9 or 9:16;
   * image-to-video follows the image proportions.
   */
  resolution?: "480p" | "768p" | "1080p" | "2k";
  /**
   * Whole seconds from 5 through 15, or auto. Defaults to 5. Auto estimates
   * quoted speech between 8 and 15 seconds.
   */
  duration?: number | "auto";
  /**
   * Output aspect ratio. Adaptive uses the first reference image, or the first
   * reference video when no images are supplied; audio-only references use 16:9.
   * Defaults to adaptive.
   */
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "adaptive";
  /**
   * Generation seed. A random seed is chosen when omitted.
   */
  seed?: number | null;
  /**
   * HTTPS webhook URL for the terminal generation event.
   */
  callback_url?: string | null;
  /**
   * Client tracking ID echoed in the terminal webhook event.
   */
  callback_id?: string | null;
  /**
   * Reference images. At most nine.
   */
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
  /**
   * Reference videos. At most three, sharing a 15-second budget. Use all footage
   * when it fits; otherwise keep up to the first five seconds of each video and
   * share the remaining budget equally among videos with footage remaining.
   */
  reference_videos?: Array<AssetUrl | AssetId | AssetBase64>;
  /**
   * Reference audio recordings. At most three.
   */
  reference_audio?: Array<AssetUrl | AssetId | AssetBase64>;
}

/**
 * A transcription by `scribe-v2`.
 */
export interface ScribeV2TranscriptionRequest {
  /**
   * The audio or video file to transcribe, as a url, an asset_id or inline
   * base64.
   */
  audio: AssetUrl | AssetId | AssetBase64;
  /**
   * Transcription model.
   */
  model: "scribe-v2";
  /**
   * Spoken language as a lowercase ISO 639 code, such as `en`. Detected from the
   * audio when omitted.
   */
  language?: string | null;
  /**
   * Return per-word timings in each segment.
   */
  word_timestamps?: boolean;
  /**
   * Label speakers. Audio is limited to 10 minutes with this on and 30 minutes
   * with it off.
   */
  diarize?: boolean;
  /**
   * Expected number of speakers; only valid with `diarize` true.
   */
  num_speakers?: number | null;
}

export type SpeechEngine = "starfish" | "orca" | "elevenlabs" | "elevenlabs_v3";

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
  /**
   * Per-item error details for batch/multi-node failures (e.g. graph compilation
   * errors by node).
   */
  errors?: Array<StandardAPIErrorDetail>;
  /**
   * Request identifier, also returned in the X-HeyGen-Request-Id response
   * header. Include it when contacting support.
   */
  request_id?: string;
}

export interface StandardAPIErrorDetail {
  /**
   * Machine-readable error code
   */
  code: string;
  /**
   * Human-readable error message
   */
  message: string;
  /**
   * Graph node id this error pertains to, if applicable
   */
  node_id?: string;
  /**
   * Port name on the node this error pertains to, if applicable
   */
  port?: string;
  /**
   * Field path within the item this error pertains to, if applicable
   */
  path?: string;
}

/**
 * Engine selection without tunable settings. Only selects the engine named by
 * ``engine_type`` on voices that support multiple engines; omit engine
 * settings to use the voice's saved default.
 */
export interface StarfishEngineSettings {
  /**
   * Engine type discriminator for this settings variant.
   */
  engine_type: "starfish";
}

/**
 * Avatar-driven source for an ``avatar_video`` studio scene. Mirrors the
 * standalone ``avatar`` creation mode (``CreateVideoFromAvatar``) minus the
 * output settings, which are global on the studio request. An audio source is
 * required: exactly one of (script + voice_id), audio_url, or audio_asset_id.
 */
export interface StudioAvatarInput {
  /**
   * Text script for the avatar to speak. Pair with voice_id, or omit voice_id
   * when using avatar_id to use the avatar's default voice. Mutually exclusive
   * with audio_url/audio_asset_id.
   */
  script?: string | null;
  /**
   * Voice ID for text-to-speech. Required when script is provided, unless
   * avatar_id is set (the avatar's default voice is used as fallback).
   */
  voice_id?: string | null;
  /**
   * Public http(s) URL of an audio file to lip-sync. Mutually exclusive with
   * script. Not a local or sandbox path (/mnt/data/..., file://); upload it and
   * pass audio_asset_id.
   */
  audio_url?: string | null;
  /**
   * HeyGen asset ID of an uploaded audio file. Mutually exclusive with script.
   */
  audio_asset_id?: string | null;
  /**
   * Voice tuning parameters (speed, pitch, locale).
   */
  voice_settings?: VoiceSettingsInput | null;
  /**
   * Must be 'avatar' for an avatar-driven scene source.
   */
  type: "avatar";
  /**
   * HeyGen avatar ID (video avatar or photo avatar look ID).
   */
  avatar_id: string;
  /**
   * Natural-language prompt controlling avatar body motion and hand gestures.
   * Supported for photo avatars on either engine, and for video avatars when
   * engine.type is 'avatar_v'. Rejected for video avatars on the default Avatar
   * IV engine, and for photo avatars on 'avatar_v' when the avatar's group has
   * no animation reference (no digital twin or curated reference look).
   */
  motion_prompt?: string | null;
  /**
   * Avatar expressiveness level. Photo avatars only. Defaults to 'low' when
   * omitted. Avatar IV only; rejected when engine.type is 'avatar_v'.
   */
  expressiveness?: Expressiveness | null;
  /**
   * Engine configuration for video generation. Pass {"type": "avatar_v"} to
   * enable cross-reference-driven animation for higher quality. Check
   * supported_api_engines on the avatar look to confirm eligibility. Defaults to
   * Avatar IV when omitted.
   */
  engine?: AvatarVEngineConfig | AvatarIVEngineConfig | AvatarIIIEngineConfig | null;
  /**
   * Optional scene background composited behind the avatar. Pass {"type":
   * "color", "color": "#RRGGBB"} for a solid color, or {"type": "image",
   * "source": {...}} or {"type": "video", "source": {...}} with the same asset
   * input image and video scenes take. Image and video backgrounds cover the
   * frame; a video background is muted and loops for the whole scene.
   */
  background?:
    | StudioColorBackgroundInput
    | StudioImageBackgroundInput
    | StudioVideoBackgroundInput
    | null;
  /**
   * Remove the avatar background. Video avatars must be trained with matting
   * enabled.
   */
  remove_background?: boolean | null;
}

/**
 * Solid-color background for an ``avatar_video`` studio scene.
 */
export interface StudioColorBackgroundInput {
  /**
   * Background type discriminator. Must be 'color'.
   */
  type: "color";
  /**
   * Background color as a 6-digit hex string, e.g. '#1a2b3c'.
   */
  color: string;
}

/**
 * Image background for an ``avatar_video`` studio scene, scaled to cover the
 * frame. ``source`` is the same asset input an ``image`` scene takes, resolved
 * the same way.
 */
export interface StudioImageBackgroundInput {
  /**
   * Background type discriminator. Must be 'image'.
   */
  type: "image";
  /**
   * Background image, scaled to cover the frame. Accepts a URL or an asset ID;
   * inline base64 is not supported for studio scenes.
   */
  source: AssetUrl | AssetId | AssetBase64;
}

/**
 * Video background for an ``avatar_video`` studio scene, scaled to cover the
 * frame. ``source`` is the same asset input a ``video`` scene takes, resolved
 * the same way. The clip is muted so it never competes with the avatar's
 * voice, and loops for the whole scene.
 */
export interface StudioVideoBackgroundInput {
  /**
   * Background type discriminator. Must be 'video'.
   */
  type: "video";
  /**
   * Background video, scaled to cover the frame, muted, and looped for the
   * length of the scene. Accepts a URL or an asset ID; inline base64 is not
   * supported for studio scenes.
   */
  source: AssetUrl | AssetId | AssetBase64;
}

export interface TextToVideoRequest {
  /**
   * Stable, opaque end-user identifier in your application, scoped to the
   * authenticated workspace. Use 1–128 non-whitespace characters without
   * personal information. Used for usage attribution and abuse investigation;
   * does not change billing, authorization, or rate limits.
   */
  end_user_id?: string | null;
  /**
   * Generate from the prompt alone.
   */
  mode: "text_to_video";
  /**
   * Required video generation model. Only heygen-video-1 is supported.
   */
  model: "heygen-video-1";
  /**
   * Instructions for the video to generate. At most 16,000 Unicode characters.
   */
  prompt: string;
  /**
   * Prompt enhancement mode: turbo, quality, ultraquality, or disabled. Defaults
   * to quality; default is an alias for turbo.
   */
  prompt_enhancement?: "turbo" | "quality" | "default" | "disabled" | "ultraquality";
  /**
   * Output resolution: 480p, 768p, 1080p, or 2k. Defaults to 768p. At 1080p and
   * 2k, text-to-video and reference-to-video require aspect_ratio 16:9 or 9:16;
   * image-to-video follows the image proportions.
   */
  resolution?: "480p" | "768p" | "1080p" | "2k";
  /**
   * Requested video duration: whole seconds from 5 through 30, or auto. Defaults
   * to 5 when omitted. Above 15 requires text_to_video or image_to_video,
   * 480p/768p/1080p/2k, and turbo/default/quality enhancement. Auto estimates
   * quoted speech with an 8-second minimum and the maximum supported by these
   * settings. Generation and billing use the resolved duration.
   */
  duration?: number | "auto";
  /**
   * Output aspect ratio for text-to-video. Defaults to 16:9.
   */
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  /**
   * Generation seed. A random seed is chosen when omitted.
   */
  seed?: number | null;
  /**
   * HTTPS webhook URL for the terminal generation event.
   */
  callback_url?: string | null;
  /**
   * Client tracking ID echoed in the terminal webhook event.
   */
  callback_id?: string | null;
}

export interface ThirdPartyGeneratedImage {
  /**
   * Download URL. It expires; read the generation again for a fresh one.
   */
  url: string;
  width: number;
  height: number;
}

export type ThirdPartyImageFailureCode =
  | "content_policy_violation"
  | "partial_generation"
  | "vendor_unavailable"
  | "ai_vendor_access_restricted"
  | "insufficient_credit"
  | "api_key_required"
  | "internal_error";

export interface ThirdPartyImageResponse {
  /**
   * Generation identifier, for reading the generation again.
   */
  id: string;
  /**
   * `completed` with its images, `failed` with a failure code, or `pending`
   * while the creating request is still running.
   */
  status: "pending" | "completed" | "failed";
  model: string;
  /**
   * Request creation time as Unix seconds.
   */
  created_at: number;
  /**
   * Generated images in output order; empty unless completed.
   */
  images: Array<ThirdPartyGeneratedImage>;
  failure_code?: ThirdPartyImageFailureCode | null;
  failure_message?: string | null;
}

export type TranscriptionCreateRequest = ScribeV2TranscriptionRequest;

export type TranscriptionFailureCode =
  | "invalid_input"
  | "vendor_unavailable"
  | "vendor_timeout"
  | "ai_vendor_access_restricted"
  | "internal_error"
  | "insufficient_credit"
  | "api_key_required"
  | "rate_limited";

export interface TranscriptionResponse {
  /**
   * Transcription identifier, for reading the transcription again.
   */
  id: string;
  /**
   * `completed` once the transcript is ready. Callers should read `status`
   * rather than assume the POST finished it.
   */
  status: TranscriptionStatus;
  /**
   * The transcription model that produced the transcript.
   */
  model: "scribe-v2";
  /**
   * Request creation time as Unix seconds.
   */
  created_at: number;
  /**
   * Detected or requested language; present once completed.
   */
  language?: string | null;
  /**
   * Length of the transcribed audio; present once completed.
   */
  duration_seconds?: number | null;
  /**
   * Full transcript; present once completed.
   */
  text?: string | null;
  /**
   * Transcript segments; present once completed.
   */
  segments?: Array<TranscriptionSegment> | null;
  /**
   * Machine-readable failure reason. Only present when status is failed.
   */
  failure_code?: TranscriptionFailureCode | null;
  /**
   * Human-readable failure description. Only present when status is failed.
   */
  failure_message?: string | null;
}

export interface TranscriptionSegment {
  /**
   * Absent when `diarize` was false.
   */
  speaker?: string | null;
  /**
   * Start time in seconds.
   */
  start: number;
  /**
   * End time in seconds.
   */
  end: number;
  /**
   * The segment's text.
   */
  text: string;
  /**
   * Present when `word_timestamps` was true.
   */
  words?: Array<TranscriptionWord> | null;
}

export type TranscriptionStatus = "pending" | "completed" | "failed";

export interface TranscriptionWord {
  /**
   * The word as spoken, with any attached punctuation.
   */
  word: string;
  /**
   * Start time in seconds.
   */
  start: number;
  /**
   * End time in seconds.
   */
  end: number;
  /**
   * Absent when `diarize` was false.
   */
  speaker?: string | null;
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

/**
 * Output video aspect ratio. - ``16:9`` / ``9:16``: classic landscape /
 * portrait. - ``4:5`` / ``5:4`` / ``1:1``: social-media-friendly ratios.
 * Output is short-edge anchored to the requested resolution (e.g. ``1080p``
 * 1:1 → 1080x1080, ``1080p`` 4:5 → 1080x1350). - ``auto``: preserve the
 * source's aspect ratio. The dimensions are derived from the avatar's source
 * frames (``avatar_id``) or the uploaded image (``image_url`` /
 * ``image_asset_id``), short-edge anchored to the requested resolution and
 * capped at the tier's long edge. Falls back to ``16:9`` when source
 * dimensions can't be read.
 */
export type VideoAspectRatio = "16:9" | "9:16" | "4:5" | "5:4" | "1:1" | "auto";

/**
 * Video resource returned by list and detail endpoints. If ``output_language``
 * is present the video is a translated video; otherwise it is a generated
 * video.
 */
export interface VideoDetail {
  /**
   * Unique video identifier
   */
  id: string;
  /**
   * Video title
   */
  title?: string | null;
  /**
   * Current video status
   */
  status: VideoStatus;
  /**
   * Unix timestamp of creation
   */
  created_at?: number | null;
  /**
   * Unix timestamp when video generation finished
   */
  completed_at?: number | null;
  /**
   * Presigned URL to download the video file
   */
  video_url?: string | null;
  /**
   * URL to video thumbnail image
   */
  thumbnail_url?: string | null;
  /**
   * URL to animated GIF preview
   */
  gif_url?: string | null;
  /**
   * Presigned URL to download the video file with captions burned in
   */
  captioned_video_url?: string | null;
  /**
   * Presigned URL to download the SRT subtitle file
   */
  subtitle_url?: string | null;
  /**
   * Video duration in seconds
   */
  duration?: number | null;
  /**
   * ID of containing folder
   */
  folder_id?: string | null;
  /**
   * BCP-47 output language code. Present only for translated videos.
   */
  output_language?: string | null;
  /**
   * Machine-readable failure reason. Only present when status is failed.
   */
  failure_code?: string | null;
  /**
   * Human-readable failure description. Only present when status is failed.
   */
  failure_message?: string | null;
  /**
   * URL to the video page in the HeyGen app
   */
  video_page_url?: string | null;
}

export type VideoGenerationModel = "heygen-video-1";

/**
 * Output container for the generated video.
 */
export type VideoOutputFormat = "mp4" | "webm";

/**
 * Output video resolution. `4k` is available for Avatar III digital twins and
 * studio avatars.
 */
export type VideoResolution = "4k" | "1080p" | "720p";

/**
 * A whole-frame scene backed by an existing video clip. Optional ``playback``
 * exposes the audio volume / mute capability; when omitted the clip plays at
 * its source volume. For optional voiceover / narration, supply at most one
 * audio source (``script`` + ``voice_id``, ``audio_url``, or
 * ``audio_asset_id``) — the *same* audio inputs a narrated ``image`` scene
 * accepts. When present, the narration drives the scene length and
 * ``playback.mode`` controls whether the clip freezes, loops, or changes speed
 * to fit that duration. When omitted the clip plays full-length as before. The
 * clip's own audio level is still governed by ``playback`` (the two compose).
 */
export interface VideoScene {
  /**
   * Must be 'video' for a video-clip scene.
   */
  type: "video";
  /**
   * Video clip to include. Accepts URL, asset ID, or base64-encoded data.
   */
  source: AssetUrl | AssetId | AssetBase64;
  /**
   * Optional playback capability: narrated-clip alignment 'mode', audio 'volume'
   * (0.0–1.0), and 'mute'. Omit to use freeze alignment and keep the clip's
   * source volume.
   */
  playback?: PlaybackInput | null;
  /**
   * Optional voiceover: text to speak over the clip. Pair with voice_id.
   * Mutually exclusive with audio_url/audio_asset_id.
   */
  script?: string | null;
  /**
   * Voice ID for text-to-speech. Required when script is provided.
   */
  voice_id?: string | null;
  /**
   * Optional voiceover: public http(s) URL of an audio file to play over the
   * clip. Mutually exclusive with script/audio_asset_id. Not a local or sandbox
   * path (/mnt/data/..., file://); upload it and pass audio_asset_id.
   */
  audio_url?: string | null;
  /**
   * Optional voiceover: HeyGen asset ID of an uploaded audio file. Mutually
   * exclusive with script/audio_url.
   */
  audio_asset_id?: string | null;
  /**
   * Voice tuning parameters (speed, pitch, locale) for a script voiceover.
   */
  voice_settings?: VoiceSettingsInput | null;
}

export type VideoStatus = "pending" | "processing" | "completed" | "failed";

export type VideoTranslationMode = "speed" | "precision";

export type VideoTranslationStatus = "pending" | "running" | "completed" | "failed";

/**
 * Voice tuning parameters for text-to-speech. Applies only when 'script' +
 * 'voice_id' are provided — not when audio_url/audio_asset_id is used
 * (uploaded audio bypasses TTS).
 */
export interface VoiceSettingsInput {
  /**
   * Playback speed multiplier. 0.5 (half speed) to 1.5 (1.5x speed).
   */
  speed?: number;
  /**
   * Pitch adjustment in semitones. -50 to +50.
   */
  pitch?: number;
  /**
   * Voice audio volume. 1.0 = full, 0.0 = silent. Useful when mixing spoken
   * voice with background audio.
   */
  volume?: number;
  /**
   * Locale/accent hint for multi-lingual voices (e.g. 'en-US').
   */
  locale?: string | null;
  /**
   * Engine-specific voice tuning, discriminated by 'engine_type'. Use the
   * variant matching the engine backing the chosen voice (e.g.
   * engine_type='elevenlabs' for ElevenLabs-backed voices,
   * engine_type='heygen_voice' for HeyGen Voice). The request is rejected if the
   * voice_id is not compatible with the selected engine. Omit to let the voice's
   * engine be chosen at render time: a HeyGen Voice professional clone always
   * renders with HeyGen Voice, while an instant clone usually does, but its
   * script language, locale, or markup tags can select another engine.
   */
  engine_settings?:
    | ElevenLabsEngineSettings
    | FishEngineSettings
    | StarfishEngineSettings
    | HeyGenVoiceEngineSettings
    | null;
}

export interface VoiceV3Item {
  /**
   * Unique voice identifier.
   */
  voice_id: string;
  /**
   * Display name of the voice.
   */
  name: string;
  /**
   * Primary language of the voice.
   */
  language: string;
  /**
   * Gender of the voice.
   */
  gender: string;
  /**
   * URL to a short audio preview of the voice.
   */
  preview_audio_url?: string | null;
  /**
   * Whether the voice supports SSML pause/break tags.
   */
  support_pause: boolean;
  /**
   * Whether the voice supports locale variants.
   */
  support_locale: boolean;
  /**
   * Whether this is a public or private voice.
   */
  type: AudioVoiceType;
  /**
   * Saved speech engine, including your preference. HeyGen Voice for most public
   * voices. Null when no usable default is saved or the default is unavailable
   * for speech.
   */
  default_engine?: SpeechEngine | null;
  /**
   * Engines this voice can use for speech generation after workspace plan and
   * vendor restrictions. Language restrictions still apply.
   */
  available_engines?: Array<SpeechEngine>;
}

/**
 * Watermark configuration for video creation.
 */
export interface WatermarkInput {
  /**
   * Image asset to use as the watermark overlay (PNG or JPEG).
   */
  image: AssetUrl | AssetId | AssetBase64;
  /**
   * Scale multiplier for the watermark image. 1.0 renders at native size.
   */
  scale?: number;
  /**
   * Watermark opacity. 0.0 is fully transparent, 1.0 is fully opaque.
   */
  opacity?: number;
  /**
   * Watermark placement. Defaults to bottom-right with standard margins when
   * omitted.
   */
  placement?: WatermarkPlacement | null;
}

/**
 * Watermark placement configuration.
 */
export interface WatermarkPlacement {
  /**
   * Anchor corner for the watermark.
   */
  position?: WatermarkPosition;
  /**
   * Fine-tune horizontal position. Fraction of frame width; 0.05 shifts 5%
   * rightward, -0.05 shifts 5% leftward.
   */
  offset_x?: number | null;
  /**
   * Fine-tune vertical position. Fraction of frame height; 0.05 shifts 5%
   * downward, -0.05 shifts 5% upward.
   */
  offset_y?: number | null;
}

/**
 * Anchor corner for a custom watermark overlay.
 */
export type WatermarkPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right";

/**
 * Word-level timing data from TTS generation.
 */
export interface WordWithTimestamp {
  /**
   * The word.
   */
  word: string;
  /**
   * Start time in seconds.
   */
  start: number;
  /**
   * End time in seconds.
   */
  end: number;
}
