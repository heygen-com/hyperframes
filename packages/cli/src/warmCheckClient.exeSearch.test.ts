import { afterEach, expect, it, vi } from "vitest";

const spawned: Array<{ env?: NodeJS.ProcessEnv } | undefined> = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const spawn = vi.fn((_command: string, _args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    spawned.push(opts);
    return { unref() {} };
  });
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const realPlatform = process.platform;
const realValue = process.env.NoDefaultCurrentDirectoryInExePath;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  if (realValue === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
  else process.env.NoDefaultCurrentDirectoryInExePath = realValue;
  vi.resetModules();
});

it("starts the next Windows warm-check server with the working-directory exe lookup off", async () => {
  delete process.env.NoDefaultCurrentDirectoryInExePath;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  vi.resetModules();
  const { startNextWarmCheck } = await import("./warmCheckClient.js");

  startNextWarmCheck({ address: "warm", token: "token" });

  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.env?.NoDefaultCurrentDirectoryInExePath).toBe("1");
});
