// During a render the page's setTimeout and setInterval run on film time and fire only at the next seek.
// The runtime's own waits and deadlines must not depend on that seek, so they use the browser's timers.
interface VirtualTimeTimers {
  originalSetTimeout?: Window["setTimeout"];
  originalClearTimeout?: Window["clearTimeout"];
  originalSetInterval?: Window["setInterval"];
  originalClearInterval?: Window["clearInterval"];
}

const shim = (): VirtualTimeTimers | undefined =>
  (globalThis as { __HF_VIRTUAL_TIME__?: VirtualTimeTimers }).__HF_VIRTUAL_TIME__;

export const wallSetTimeout: Window["setTimeout"] = (handler, timeout, ...args) =>
  (shim()?.originalSetTimeout ?? globalThis.setTimeout)(handler, timeout, ...args);

export const wallClearTimeout: Window["clearTimeout"] = (id) =>
  (shim()?.originalClearTimeout ?? globalThis.clearTimeout)(id);

export const wallSetInterval: Window["setInterval"] = (handler, timeout, ...args) =>
  (shim()?.originalSetInterval ?? globalThis.setInterval)(handler, timeout, ...args);

export const wallClearInterval: Window["clearInterval"] = (id) =>
  (shim()?.originalClearInterval ?? globalThis.clearInterval)(id);
