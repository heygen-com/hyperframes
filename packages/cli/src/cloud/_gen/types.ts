/**
 * AUTO-GENERATED from experiment-framework/openapi/external-api.json.
 * DO NOT EDIT MANUALLY. Re-run
 * `python scripts/generate_hyperframes_cli_client.py` in
 * experiment-framework to regenerate.
 */

// Component schemas reachable from the cloud-render endpoint set.
// Add a new path/method to TARGET_ENDPOINTS in
// scripts/generate_hyperframes_cli_client.py to extend this list.

export interface AbortAssetUploadResponse {
  asset_id: string;
  status: "aborted";
}

export interface AssetBase64 {
  type: "base64";
  media_type: string;
  data: string;
}

export interface AssetId {
  type: "asset_id";
  asset_id: string;
}

export interface AssetUrl {
  type: "url";
  url: string;
}

export type AudioVoiceType = "public" | "private";

export type AvatarFit = "contain" | "cover";

export interface AvatarIIIEngineConfig {
  type: "avatar_iii";
}

export interface AvatarIVEngineConfig {
  type: "avatar_iv";
}

export interface AvatarVEngineConfig {
  type: "avatar_v";
  reference_look_id?: string | null;
  more_blinking?: boolean;
}

export interface AvatarVideoScene {
  type: "avatar_video";
  input: StudioAvatarInput;
}

export interface BackgroundRemovalJob {
  id: string;
  status: string;
  layers?: Record<string, unknown>;
  duration?: number | null;
  created_at?: number | null;
  completed_at?: number | null;
  error?: string | null;
}

export interface BackgroundSetting {
  type: "color" | "image";
  value?: string | null;
  url?: string | null;
  asset_id?: string | null;
}

export type CaptionFileFormat = "srt";

export interface CaptionSetting {
  file_format?: CaptionFileFormat;
  style?: CaptionStyle | null;
}

export type CaptionStyle = "default";

export type ChargedPool = "api_credits" | "hyperframes_credits" | "web_credits" | "free_images";

export type CinematicAvatarModel = "seedance_2" | "heygen_video_1";

export interface CompleteAssetUploadRequest {
  checksum_sha256?: string | null;
  multipart_upload_id?: string | null;
  parts?: Array<CompletedPart> | null;
}

export interface CompleteAssetUploadResponse {
  asset_id: string;
  url: string;
  mime_type: string;
  size_bytes: number;
  status: "processing";
}

export interface CompletedPart {
  part_number: number;
  etag: string;
}

export interface CreateAssetUploadRequest {
  filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256?: string | null;
  multipart?: boolean | null;
}

export interface CreateAssetUploadResponse {
  asset_id: string;
  upload_url: string;
  upload_headers: Record<string, unknown>;
  expires_in_seconds: number;
  max_bytes: number;
  status: "pending_upload";
  multipart?: MultipartUploadPlan | null;
}

export interface CreateBackgroundRemovalRequest {
  video: AssetUrl | AssetId | AssetBase64;
  layers?: Array<string>;
  title?: string | null;
  request_id?: string | null;
}

export interface CreateHyperframesRenderRequest {
  project: AssetUrl | AssetId | AssetBase64;
  fps?: number | null;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov";
  crf?: number | null;
  max_bitrate?: string | null;
  buffer_size?: string | null;
  resolution?: HyperframesResolution;
  aspect_ratio?: HyperframesAspectRatio;
  composition?: string | null;
  variables?: Record<string, unknown> | null;
  title?: string | null;
  callback_id?: string | null;
  callback_url?: string | null;
  reverse_session_id?: string | null;
}

export interface CreateHyperframesRenderResponse {
  render_id: string;
}

export interface CreateLipsyncRequest {
  video: AssetUrl | AssetId;
  audio: AssetUrl | AssetId;
  title?: string | null;
  mode?: VideoTranslationMode;
  callback_url?: string | null;
  callback_id?: string | null;
  enable_caption?: boolean;
  keep_the_same_format?: boolean | null;
  enable_dynamic_duration?: boolean;
  disable_music_track?: boolean;
  enable_speech_enhancement?: boolean;
  enable_watermark?: boolean;
  start_time?: number | null;
  end_time?: number | null;
  fps_mode?: string | null;
  folder_id?: string | null;
}

export type CreateModelVideoRequest =
  | TextToVideoRequest
  | ImageToVideoRequest
  | ReferenceToVideoRequest;

export interface CreateModelVideoResponse {
  video_id: string;
  status?: "pending";
  input_video_duration?: number | null;
}

export interface CreateSpeechV3OutputFormat {
  encoding: "mp3" | "wav";
  sample_rate_hertz?: number | null;
  bit_depth?: number | null;
  num_channels?: number;
  bitrate_bps?: number | null;
}

export interface CreateSpeechV3Request {
  text: string;
  voice_id: string;
  input_type?: string;
  speed?: number;
  language?: string | null;
  locale?: string | null;
  force_regenerate?: boolean;
  engine?: "heygen_voice" | "starfish" | "orca" | "elevenlabs" | "elevenlabs_v3" | null;
  settings?: ElevenLabsSpeechSettings | null;
  brand_glossary_id?: string | null;
  output_format?: CreateSpeechV3OutputFormat | null;
}

export interface CreateSpeechV3ResponseData {
  audio_url: string;
  duration: number;
  request_id?: string | null;
  word_timestamps?: Array<WordWithTimestamp> | null;
  engine: SpeechEngine;
}

export interface CreateVideoFromAvatar {
  title?: string | null;
  folder_id?: string | null;
  resolution?: VideoResolution | null;
  aspect_ratio?: VideoAspectRatio | null;
  fit?: AvatarFit | null;
  background?: BackgroundSetting | null;
  remove_background?: boolean | null;
  callback_url?: string | null;
  callback_id?: string | null;
  output_upload?: OutputUploadRequest | null;
  watermark?: WatermarkInput | null;
  caption?: CaptionSetting | null;
  output_format?: VideoOutputFormat;
  script?: string | null;
  voice_id?: string | null;
  audio_url?: string | null;
  audio_asset_id?: string | null;
  voice_settings?: VoiceSettingsInput | null;
  type: "avatar";
  avatar_id: string;
  brand_glossary_id?: string | null;
  motion_prompt?: string | null;
  expressiveness?: Expressiveness | null;
  engine?: AvatarVEngineConfig | AvatarIVEngineConfig | AvatarIIIEngineConfig | null;
}

export interface CreateVideoFromCinematicAvatar {
  type: "cinematic_avatar";
  prompt: string;
  avatar_id: Array<string>;
  model?: CinematicAvatarModel | null;
  references?: Array<AssetUrl | AssetId | AssetBase64> | null;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  resolution?: "720p" | "1080p";
  auto_duration?: boolean;
  duration?: number | null;
  enhance_prompt?: boolean;
  title?: string | null;
  folder_id?: string | null;
}

export interface CreateVideoFromImage {
  title?: string | null;
  folder_id?: string | null;
  resolution?: VideoResolution | null;
  aspect_ratio?: VideoAspectRatio | null;
  fit?: AvatarFit | null;
  background?: BackgroundSetting | null;
  remove_background?: boolean | null;
  callback_url?: string | null;
  callback_id?: string | null;
  output_upload?: OutputUploadRequest | null;
  watermark?: WatermarkInput | null;
  caption?: CaptionSetting | null;
  output_format?: VideoOutputFormat;
  script?: string | null;
  voice_id?: string | null;
  audio_url?: string | null;
  audio_asset_id?: string | null;
  voice_settings?: VoiceSettingsInput | null;
  type: "image";
  image: AssetUrl | AssetId | AssetBase64;
  brand_glossary_id?: string | null;
  motion_prompt?: string | null;
  expressiveness?: Expressiveness | null;
}

export interface CreateVideoFromStudio {
  type: "studio";
  title?: string | null;
  folder_id?: string | null;
  aspect_ratio?: VideoAspectRatio | null;
  resolution?: VideoResolution | null;
  brand_glossary_id?: string | null;
  callback_url?: string | null;
  callback_id?: string | null;
  caption?: CaptionSetting | null;
  watermark?: WatermarkInput | null;
  scenes: Array<AvatarVideoScene | ImageScene | VideoScene>;
}

export type CreateVideoV3RequestBody =
  | CreateVideoFromAvatar
  | CreateVideoFromImage
  | CreateVideoFromCinematicAvatar
  | CreateVideoFromStudio;

export interface CreateVideoV3Response {
  video_id: string;
  status: string;
  output_format?: VideoOutputFormat;
  resolution?: VideoResolution | null;
  resolution_note?: string | null;
}

export interface DeleteHyperframesRenderResponse {
  render_id: string;
}

export type DeliveryArtifact = "video" | "captions" | "thumbnail";

export type DeliveryErrorCode =
  | "upload_url_expired"
  | "upload_rejected"
  | "upload_target_not_found"
  | "output_too_large"
  | "provider_unavailable"
  | "source_missing"
  | "internal_error";

export type DeliveryStatus = "pending" | "in_progress" | "succeeded" | "failed";

export interface ElevenLabsEngineSettings {
  model?: ElevenLabsModel | null;
  similarity_boost?: number | null;
  stability?: number | null;
  style?: number | null;
  use_speaker_boost?: boolean | null;
  engine_type: "elevenlabs";
}

export type ElevenLabsModel =
  | "eleven_multilingual_v2"
  | "eleven_turbo_v2_5"
  | "eleven_flash_v2_5"
  | "eleven_v3"
  | "eleven_v4";

export interface ElevenLabsSpeechSettings {
  model_id:
    | "eleven_multilingual_v2"
    | "eleven_flash_v2"
    | "eleven_flash_v2_5"
    | "eleven_turbo_v2_5"
    | "eleven_v3"
    | "eleven_v4";
}

export type Expressiveness = "high" | "medium" | "low";

export interface FileDeliveryStatus {
  artifact: DeliveryArtifact;
  status: DeliveryStatus;
  target_host: string;
  size_bytes?: number | null;
  error_code?: DeliveryErrorCode | null;
  completed_at?: number | null;
}

export interface FishEngineSettings {
  model?: FishModel | null;
  stability?: number | null;
  similarity?: number | null;
  engine_type: "fish";
}

export type FishModel = "s1" | "s2-pro" | "s2.1-pro";

export interface GptImage25Request {
  model: "gpt-image-2.5";
  prompt: string;
  num_images?: number;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | null;
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

export interface GptImage26FlareRequest {
  model: "gpt-image-2.6-flare";
  prompt: string;
  num_images?: number;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | null;
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

export interface GptImage26Request {
  model: "gpt-image-2.6";
  prompt: string;
  num_images?: number;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | null;
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

export interface HeyGenVoiceEngineSettings {
  engine_type: "heygen_voice" | "orca";
}

export type HyperframesAspectRatio = "16:9" | "9:16" | "1:1";

export interface HyperframesReferenceBackground {
  kind: "solid" | "none" | "unsupported_non_solid" | "unknown";
  rgb?: Array<unknown> | null;
}

export interface HyperframesRenderDetail {
  render_id: string;
  status: HyperframesRenderStatus;
  title?: string | null;
  callback_id?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  fps?: number | null;
  quality?: "draft" | "standard" | "high" | null;
  format: "mp4" | "webm" | "mov";
  resolution?: HyperframesResolution | null;
  aspect_ratio?: HyperframesAspectRatio | null;
  composition?: string | null;
  reference_background?: HyperframesReferenceBackground | null;
  created_at?: number | null;
  completed_at?: number | null;
  failure_message?: string | null;
  failure_code?: string | null;
}

export type HyperframesRenderStatus = "queued" | "rendering" | "completed" | "failed";

export type HyperframesResolution = "1080p" | "4k";

export type ImageCreateRequest =
  | GptImage25Request
  | GptImage26Request
  | GptImage26FlareRequest
  | NanoBanana2Request
  | NanoBanana21Request;

export interface ImageScene {
  type: "image";
  source: AssetUrl | AssetId | AssetBase64;
  duration?: number | null;
  script?: string | null;
  voice_id?: string | null;
  audio_url?: string | null;
  audio_asset_id?: string | null;
  voice_settings?: VoiceSettingsInput | null;
}

export interface ImageToVideoRequest {
  end_user_id?: string | null;
  mode: "image_to_video";
  model: "heygen-video-1";
  prompt: string;
  prompt_enhancement?: "turbo" | "quality" | "default" | "disabled" | "ultraquality";
  resolution?: "480p" | "768p" | "1080p" | "2k";
  duration?: number | "auto";
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "adaptive" | null;
  seed?: number | null;
  callback_url?: string | null;
  callback_id?: string | null;
  image: AssetUrl | AssetId | AssetBase64;
  end_image?: AssetUrl | AssetId | AssetBase64 | null;
}

export interface LipsyncCreateResponse {
  lipsync_id: string;
}

export interface LipsyncDetail {
  id: string;
  title?: string | null;
  status: VideoTranslationStatus;
  duration?: number | null;
  video_url?: string | null;
  caption_url?: string | null;
  callback_id?: string | null;
  created_at?: number | null;
  failure_message?: string | null;
  failure_code?: string | null;
}

export interface ListUploadedPartsResponse {
  parts: Array<UploadedPart>;
}

export interface LyriaMusicRequest {
  model: "lyria-3-pro";
  prompt: string;
  duration_seconds: number;
  bpm?: number | null;
  intensity?: number | null;
  instrumental?: boolean;
  lyrics?: string | null;
}

export interface MintPartUrlsRequest {
  multipart_upload_id: string;
  part_numbers: Array<number>;
}

export interface MintPartUrlsResponse {
  parts: Array<PartUrl>;
  expires_in_seconds: number;
}

export interface ModelVideoResponse {
  video_id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  model: VideoGenerationModel;
  created_at: number;
  video_url?: string | null;
  duration?: number | null;
  input_video_duration?: number | null;
  aspect_ratio?: string | null;
  width?: number | null;
  height?: number | null;
  seed?: number | null;
  timings?: ModelVideoTimings | null;
  failure_code?: "generation_failed" | "generation_cancelled" | "usage_limit_reached" | null;
  failure_message?: string | null;
}

export interface ModelVideoTimings {
  inference: number;
}

export interface MultipartUploadPlan {
  multipart_upload_id: string;
  part_size_bytes: number;
  part_count: number;
}

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
  id: string;
  status: MusicStatus;
  model: "lyria-3-pro";
  created_at?: number | null;
  requested_duration_seconds: number;
  duration_seconds?: number | null;
  audio_url?: string | null;
  format?: "mp3" | null;
  failure_code?: MusicFailureCode | null;
  failure_message?: string | null;
}

export type MusicStatus = "pending" | "completed" | "failed";

export interface NanoBanana21Request {
  model: "nano-banana-2.1";
  prompt: string;
  num_images?: number;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | null;
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

export interface NanoBanana2Request {
  model: "nano-banana-2";
  prompt: string;
  num_images?: number;
  aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | null;
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
}

export interface OutputUploadRequest {
  video: UploadTargetRequest;
  captions?: UploadTargetRequest | null;
  thumbnail?: UploadTargetRequest | null;
}

export interface PartUrl {
  part_number: number;
  upload_url: string;
}

export interface PlaybackInput {
  mode?: "freeze" | "loop" | "fit_to_scene" | null;
  volume?: number;
  mute?: boolean;
}

export interface ReferenceToVideoRequest {
  end_user_id?: string | null;
  mode: "reference_to_video";
  model: "heygen-video-1";
  prompt: string;
  prompt_enhancement?: "turbo" | "quality" | "default" | "disabled" | "ultraquality";
  resolution?: "480p" | "768p" | "1080p" | "2k";
  duration?: number | "auto";
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "adaptive";
  seed?: number | null;
  callback_url?: string | null;
  callback_id?: string | null;
  reference_images?: Array<AssetUrl | AssetId | AssetBase64>;
  reference_videos?: Array<AssetUrl | AssetId | AssetBase64>;
  reference_audio?: Array<AssetUrl | AssetId | AssetBase64>;
}

export interface ScribeV2TranscriptionRequest {
  audio: AssetUrl | AssetId | AssetBase64;
  model: "scribe-v2";
  language?: string | null;
  word_timestamps?: boolean;
  diarize?: boolean;
  num_speakers?: number | null;
}

export type SpeechEngine = "starfish" | "orca" | "elevenlabs" | "elevenlabs_v3";

export interface StandardAPIError {
  code: string;
  message: string;
  param?: string | null;
  doc_url?: string | null;
  errors?: Array<StandardAPIErrorDetail>;
  request_id?: string;
}

export interface StandardAPIErrorDetail {
  code: string;
  message: string;
  node_id?: string;
  port?: string;
  path?: string;
}

export interface StarfishEngineSettings {
  engine_type: "starfish";
}

export interface StudioAvatarInput {
  script?: string | null;
  voice_id?: string | null;
  audio_url?: string | null;
  audio_asset_id?: string | null;
  voice_settings?: VoiceSettingsInput | null;
  type: "avatar";
  avatar_id: string;
  motion_prompt?: string | null;
  expressiveness?: Expressiveness | null;
  engine?: AvatarVEngineConfig | AvatarIVEngineConfig | AvatarIIIEngineConfig | null;
  background?:
    | StudioColorBackgroundInput
    | StudioImageBackgroundInput
    | StudioVideoBackgroundInput
    | null;
  remove_background?: boolean | null;
}

export interface StudioColorBackgroundInput {
  type: "color";
  color: string;
}

export interface StudioImageBackgroundInput {
  type: "image";
  source: AssetUrl | AssetId | AssetBase64;
}

export interface StudioVideoBackgroundInput {
  type: "video";
  source: AssetUrl | AssetId | AssetBase64;
}

export interface TextToVideoRequest {
  end_user_id?: string | null;
  mode: "text_to_video";
  model: "heygen-video-1";
  prompt: string;
  prompt_enhancement?: "turbo" | "quality" | "default" | "disabled" | "ultraquality";
  resolution?: "480p" | "768p" | "1080p" | "2k";
  duration?: number | "auto";
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  seed?: number | null;
  callback_url?: string | null;
  callback_id?: string | null;
}

export interface ThirdPartyGeneratedImage {
  url: string;
  width: number;
  height: number;
}

export interface ThirdPartyImageCharge {
  amount: number;
  pool: ChargedPool;
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
  id: string;
  status: "pending" | "completed" | "failed";
  model: string;
  created_at: number;
  images: Array<ThirdPartyGeneratedImage>;
  failure_code?: ThirdPartyImageFailureCode | null;
  failure_message?: string | null;
  charged?: ThirdPartyImageCharge | null;
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
  id: string;
  status: TranscriptionStatus;
  model: "scribe-v2";
  created_at: number;
  language?: string | null;
  duration_seconds?: number | null;
  text?: string | null;
  segments?: Array<TranscriptionSegment> | null;
  failure_code?: TranscriptionFailureCode | null;
  failure_message?: string | null;
}

export interface TranscriptionSegment {
  speaker?: string | null;
  start: number;
  end: number;
  text: string;
  words?: Array<TranscriptionWord> | null;
}

export type TranscriptionStatus = "pending" | "completed" | "failed";

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  speaker?: string | null;
}

export interface UploadAssetV3Response {
  asset_id: string;
  url: string;
  mime_type: string;
  size_bytes: number;
}

export interface UploadTargetRequest {
  url: string;
  headers?: Record<string, unknown>;
}

export interface UploadedPart {
  part_number: number;
  size_bytes: number;
  etag: string;
}

export type VideoAspectRatio = "16:9" | "9:16" | "4:5" | "5:4" | "1:1" | "auto";

export interface VideoDetail {
  id: string;
  title?: string | null;
  status: VideoStatus;
  created_at?: number | null;
  completed_at?: number | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  gif_url?: string | null;
  captioned_video_url?: string | null;
  subtitle_url?: string | null;
  duration?: number | null;
  folder_id?: string | null;
  output_language?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  video_page_url?: string | null;
  delivery?: Array<FileDeliveryStatus> | null;
}

export type VideoGenerationModel = "heygen-video-1";

export type VideoOutputFormat = "mp4" | "webm";

export type VideoResolution = "4k" | "1080p" | "720p";

export interface VideoScene {
  type: "video";
  source: AssetUrl | AssetId | AssetBase64;
  playback?: PlaybackInput | null;
  script?: string | null;
  voice_id?: string | null;
  audio_url?: string | null;
  audio_asset_id?: string | null;
  voice_settings?: VoiceSettingsInput | null;
}

export type VideoStatus = "pending" | "processing" | "completed" | "failed";

export type VideoTranslationMode = "speed" | "precision";

export type VideoTranslationStatus = "pending" | "running" | "completed" | "failed";

export interface VoiceSettingsInput {
  speed?: number;
  pitch?: number;
  volume?: number;
  locale?: string | null;
  engine_settings?:
    | ElevenLabsEngineSettings
    | FishEngineSettings
    | StarfishEngineSettings
    | HeyGenVoiceEngineSettings
    | null;
}

export interface VoiceV3Item {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio_url?: string | null;
  support_pause: boolean;
  support_locale: boolean;
  type: AudioVoiceType;
  default_engine?: SpeechEngine | null;
  available_engines?: Array<SpeechEngine>;
}

export interface WatermarkInput {
  image: AssetUrl | AssetId | AssetBase64;
  scale?: number;
  opacity?: number;
  placement?: WatermarkPlacement | null;
}

export interface WatermarkPlacement {
  position?: WatermarkPosition;
  offset_x?: number | null;
  offset_y?: number | null;
}

export type WatermarkPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right";

export interface WordWithTimestamp {
  word: string;
  start: number;
  end: number;
}
