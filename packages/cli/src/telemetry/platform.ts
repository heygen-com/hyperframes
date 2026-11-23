// Shared host-platform detectors used by both system.ts (overall metadata)
// and agent_runtime.ts (sandbox fingerprinting). Lives in its own module
// to avoid an import cycle between those two files.

export { detectWsl as detectWSL } from "@hyperframes/engine/wsl-host";
