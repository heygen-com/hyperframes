export { loadElevenLabsKey, ELEVENLABS_KEY_NAME } from "./env.js";
export {
  listVoices,
  fetchVoicePreview,
  synthesize,
  fileExtensionForFormat,
  ElevenLabsError,
} from "./client.js";
export type { ElevenLabsVoice, SynthesizeOptions } from "./client.js";
