// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

// The module-scope kick in Player.tsx consumes the first attempt, so this
// starts failing and the test turns it off to observe the retry.
const state = vi.hoisted(() => ({ attempts: 0, failing: true }));

vi.mock("@hyperframes/player", () => {
  state.attempts += 1;
  if (state.failing) throw new Error("chunk load failed");
  return {};
});

import { loadPlayerModule } from "./Player";

describe("loadPlayerModule", () => {
  it("re-imports after a failed load so a remount can recover", async () => {
    // vitest rewraps a throwing mock factory, so assert the rejection, not its text.
    await expect(loadPlayerModule()).rejects.toThrow();
    const failedAttempts = state.attempts;

    state.failing = false;

    await expect(loadPlayerModule()).resolves.toBeDefined();
    expect(state.attempts).toBeGreaterThan(failedAttempts);
  });

  it("reuses the resolved module instead of re-importing on every mount", async () => {
    state.failing = false;
    await loadPlayerModule();
    const settled = state.attempts;

    await loadPlayerModule();
    await loadPlayerModule();

    expect(state.attempts).toBe(settled);
  });
});
