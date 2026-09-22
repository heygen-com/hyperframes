import { writeFileSync } from "node:fs";

export function writeCaptureFileSync(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  options?: Parameters<typeof writeFileSync>[2],
): void {
  const normalized = typeof options === "string" ? { encoding: options } : options;
  writeFileSync(path, data, { ...normalized, mode: 0o600 });
}
