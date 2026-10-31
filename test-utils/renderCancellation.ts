import { existsSync } from "node:fs";
import { expect, vi } from "vitest";

export function waitForRenderCancellation(
  signal: AbortSignal,
  lateCompletion: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        if (lateCompletion) resolve();
        else reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

export async function cancelAndVerifyArtifacts(
  state: { status: string; cancel?: () => void },
  outputPath: string,
  metaPath: string,
): Promise<void> {
  await vi.waitFor(() => expect(existsSync(metaPath)).toBe(true));
  state.cancel?.();
  await vi.waitFor(() => expect(state.status).toBe("cancelled"));
  expect(existsSync(outputPath)).toBe(false);
  expect(existsSync(metaPath)).toBe(false);
}
