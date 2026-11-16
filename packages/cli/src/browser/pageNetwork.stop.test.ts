import { existsSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";

const stop = vi.hoisted(() => ({
  cleanups: [] as (() => Promise<void>)[],
  profileStarted: undefined as (() => void) | undefined,
  finishProfile: undefined as (() => void) | undefined,
  made: [] as string[],
}));

vi.mock("./launch.js", () => ({
  registerBrowserSessionCleanup: (cleanup: () => Promise<void>) => {
    stop.cleanups.push(cleanup);
    return () => void stop.cleanups.splice(stop.cleanups.indexOf(cleanup), 1);
  },
}));

// The profile is made only once the test lets it finish, so a stop can land while it is being made.
vi.mock("@hyperframes/engine/public-network", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/engine/public-network")>();
  return {
    ...real,
    createPublicOnlyProfile: async (prefix: string) => {
      stop.profileStarted?.();
      await new Promise<void>((resolve) => (stop.finishProfile = resolve));
      const made = await real.createPublicOnlyProfile(prefix);
      stop.made.push(made);
      return made;
    },
  };
});

const { launchWithPageNetwork } = await import("./pageNetwork.js");

afterEach(() => {
  vi.unstubAllEnvs();
});

// fails without the fix: a stop that landed while the profile was being made ran before the profile had a path, so
// the profile made a moment later stayed in the temp folder.
it("removes a profile still being made when the CLI stops, and launches no Chrome", async () => {
  vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
  const started = new Promise<void>((resolve) => (stop.profileStarted = resolve));
  const launch = vi.fn(async () => ({ connected: true, once: () => {} }) as unknown as Browser);
  const launching = launchWithPageNetwork("http://127.0.0.1:4000/", launch);
  await started;
  const stopping = Promise.all(stop.cleanups.map((cleanup) => cleanup()));
  stop.finishProfile?.();
  await stopping;
  await expect(launching).rejects.toThrow(/stopping/);
  expect(launch).not.toHaveBeenCalled();
  expect(stop.made).toHaveLength(1);
  expect(existsSync(stop.made[0]!)).toBe(false);
});
