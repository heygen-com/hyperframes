// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { PausedVideoFrameProvider } from "@hyperframes/core";
import { attachPausedVideoProvider } from "./pausedVideoProvider";

const decoder = vi.hoisted(() => ({
  decode: vi.fn(async () => []),
  suspend: vi.fn(async () => {}),
  dispose: vi.fn(),
}));
vi.mock("./pausedVideoDecoder", () => ({ createPausedVideoDecoder: () => decoder }));

it("forwards native-play suspension through the lazy provider facade", async () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const install = vi.fn<(provider: PausedVideoFrameProvider) => void>();
  const win = iframe.contentWindow!;
  Object.assign(win, {
    __hf: {
      setPausedVideoFrameProvider: install,
    },
  });
  attachPausedVideoProvider(iframe, win);
  const provider = install.mock.calls[0]![0];
  await provider.decode([], new AbortController().signal);
  await provider.suspend?.();
  expect(decoder.suspend).toHaveBeenCalledOnce();
  await provider.decode([], new AbortController().signal);
  expect(decoder.decode).toHaveBeenCalledTimes(2);
  win.dispatchEvent(new Event("pagehide"));
  await Promise.resolve();
  expect(decoder.dispose).toHaveBeenCalledOnce();
  iframe.remove();
});

it("allows native-play suspension after the lazy decoder chunk rejects", async () => {
  vi.resetModules();
  vi.doMock("./pausedVideoDecoder", () => {
    throw new Error("decoder chunk unavailable");
  });
  const { attachPausedVideoProvider: attach } = await import("./pausedVideoProvider");
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const install = vi.fn<(provider: PausedVideoFrameProvider) => void>();
  const win = iframe.contentWindow!;
  Object.assign(win, { __hf: { setPausedVideoFrameProvider: install } });
  attach(iframe, win);
  const provider = install.mock.calls[0]![0];
  await expect(provider.decode([], new AbortController().signal)).rejects.toThrow();
  await expect(provider.suspend!()).resolves.toBeUndefined();
  win.dispatchEvent(new Event("pagehide"));
  iframe.remove();
});
