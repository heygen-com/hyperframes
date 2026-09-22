// Compatibility copy for the audio helpers that still import the historical
// skill-relative path. The CLI-owned engine is the source of truth.
export {
  fetchMedia,
  isPublicMediaUrl,
} from "../../../../packages/cli/src/media-use/lib/media-fetch.mjs";
