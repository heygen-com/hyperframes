/**
 * Bonanza Labs Integration for HyperFrames
 * 
 * LLM-agnostic video creation pipeline with voice, avatars, and payments.
 */

// LLM Providers
export { OllamaProvider, OpenAICompatibleProvider, TemplateProvider, createProvider, defaultProvider } from './llm/provider.js';
export type { LLMProvider, ProviderConfig, VideoScript, Scene, ScriptOptions } from './llm/provider.js';

// Voice Providers
export { EdgeTTSProvider, ElevenLabsProvider, createVoiceProvider, defaultVoiceProvider } from './voice/provider.js';
export type { VoiceProvider, VoiceConfig, VoiceOptions, VoiceResult, VoiceInfo } from './voice/provider.js';

// Avatar Providers
export { HeyGenAvatarProvider, createAvatarProvider } from './avatar/provider.js';
export type { AvatarProvider, AvatarRequest, AvatarJob, AvatarResult, AvatarInfo } from './avatar/provider.js';

// Payment Providers
export { X402PaymentProvider, createPaymentProvider, VIDEO_PRICING } from './payment/provider.js';
export type { PaymentProvider, PaymentInvoice, PaymentStatus, VideoTier } from './payment/provider.js';

// Pipeline
export { VideoPipeline, generateVideo } from './pipeline.js';
export type { PipelineConfig, PipelineResult } from './pipeline.js';