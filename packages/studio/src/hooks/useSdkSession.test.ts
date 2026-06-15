import { describe, expect, it } from "vitest";
import { shouldReloadSdkSession } from "./useSdkSession";

// ── undo-sync contract ────────────────────────────────────────────────────────
// useSdkSession exposes forceReload() so callers can bypass the 2 s self-write
// suppress window. useAppHotkeys calls forceReload() after a successful
// undo/redo that wrote the active composition path. Without it, the suppress
// window swallows the file-change event and the SDK session stays stale.
//
// The React hook internals (useState / useEffect) cannot be unit-tested without
// a full render environment; the correctness of the suppress-bypass path is
// covered by the integration tests in usePersistentEditHistory.test.ts
// (which verify undo writes the correct before-content to disk).
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldReloadSdkSession", () => {
  it("reloads when the changed file is the active composition", () => {
    expect(shouldReloadSdkSession({ path: "scenes/intro.html" }, "scenes/intro.html")).toBe(true);
  });

  it("ignores changes to other files", () => {
    expect(shouldReloadSdkSession({ path: "styles/main.css" }, "scenes/intro.html")).toBe(false);
  });

  it("ignores changes when no composition is active", () => {
    expect(shouldReloadSdkSession({ path: "scenes/intro.html" }, null)).toBe(false);
  });

  it("ignores payloads with no resolvable path", () => {
    expect(shouldReloadSdkSession({}, "scenes/intro.html")).toBe(false);
  });
});
