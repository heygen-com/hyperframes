/**
 * Type augmentation for Chrome's HeadlessExperimental CDP domain.
 *
 * Puppeteer's CDPSession.send() is typed against devtools-protocol's
 * ProtocolMapping.Commands, which does not include HeadlessExperimental.
 * This module augmentation adds proper types so we can call these methods
 * without unsafe `as any` casts.
 */

/** Parameters for HeadlessExperimental.beginFrame */
interface HeadlessExperimentalBeginFrameRequest {
  /** Timestamp in milliseconds since epoch for the frame */
  frameTimeTicks: number;
  /** Interval in milliseconds between frames */
  interval: number;
  /** If true, do not produce display updates (warmup mode) */
  noDisplayUpdates?: boolean;
  /** Optional screenshot configuration */
  screenshot?: {
    format: "jpeg" | "png";
    quality?: number;
    optimizeForSpeed?: boolean;
  };
}

/** Response from HeadlessExperimental.beginFrame */
interface HeadlessExperimentalBeginFrameResponse {
  /** Whether the compositor reported visual damage */
  hasDamage: boolean;
  /** Base64-encoded screenshot data (present only when screenshot was requested and hasDamage is true) */
  screenshotData?: string;
}

export {};

declare module "devtools-protocol/types/protocol-mapping.js" {
  // Merge into the existing ProtocolMapping namespace
  export namespace ProtocolMapping {
    interface Commands {
      "HeadlessExperimental.enable": {
        paramsType: [];
        returnType: void;
      };
      "HeadlessExperimental.disable": {
        paramsType: [];
        returnType: void;
      };
      "HeadlessExperimental.beginFrame": {
        paramsType: [HeadlessExperimentalBeginFrameRequest];
        returnType: HeadlessExperimentalBeginFrameResponse;
      };
    }
  }
}
