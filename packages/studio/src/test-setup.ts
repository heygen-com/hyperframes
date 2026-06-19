if (typeof globalThis.CSS === "undefined") {
  (globalThis as Record<string, unknown>).CSS = {};
}
if (typeof CSS.escape !== "function") {
  CSS.escape = (value: string) => value.replace(/([^\w-])/g, "\\$1");
}
