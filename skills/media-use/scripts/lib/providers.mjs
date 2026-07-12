// Back-compat surface for the v1 provider API. The ordered, capability-based
// registry now lives in registry.mjs; this re-exports the v1 helpers so existing
// callers keep working. New code should import from registry.mjs directly
// (getProviders / runCapability).
export { getProvider, listTypes } from "./registry.mjs";
