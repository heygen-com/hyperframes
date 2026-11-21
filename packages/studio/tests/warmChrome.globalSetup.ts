import { warmTestChrome } from "./chromeTestUtils";

/** Vitest global setup: runs once, before any test worker starts. */
export default async function setup(): Promise<void> {
  await warmTestChrome();
}
