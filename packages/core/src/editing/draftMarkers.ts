/**
 * Browser-safe wire constants shared by the runtime, Studio, and studio-server.
 *
 * Keep this module dependency-free. These names are part of the edit protocol,
 * not server implementation details, so browser code must be able to import
 * them without pulling the studio-server package into its graph.
 */
export const STUDIO_OFFSET_X_PROP = "--hf-studio-offset-x";
export const STUDIO_OFFSET_Y_PROP = "--hf-studio-offset-y";
export const STUDIO_WIDTH_PROP = "--hf-studio-width";
export const STUDIO_HEIGHT_PROP = "--hf-studio-height";
export const STUDIO_MANUAL_EDIT_GESTURE_ATTR = "data-hf-studio-manual-edit-gesture";
