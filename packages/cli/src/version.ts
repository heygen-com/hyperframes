declare const __CLI_VERSION__: string | undefined;
declare const __PRODUCER_VERSION__: string | undefined;
export const VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";
export const PRODUCER_VERSION =
  typeof __PRODUCER_VERSION__ !== "undefined" ? __PRODUCER_VERSION__ : "0.0.0-dev";
