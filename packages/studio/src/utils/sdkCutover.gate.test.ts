import { describe, expect, it, vi } from "vitest";

// Dark-launch contract: with STUDIO_SDK_CUTOVER_ENABLED=false, EVERY cutover
// persist chokepoint must return false so the caller takes the legacy server
// path — even when a valid SDK session exists (one always does, for
// shadow/selection). This is the contract the prod flag-flip rests on; a future
// refactor of the gate guards that silently re-enables cutover on flag-off
// turns these red. (sdkCutover.test.ts mocks the flag TRUE; this is its sibling.)
vi.mock("../components/editor/manualEditingAvailability", () => ({
  STUDIO_SDK_CUTOVER_ENABLED: false,
}));
vi.mock("./studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

import { sdkTimingPersist, sdkGsapTweenPersist, sdkDeletePersist } from "./sdkCutover";

const makeSession = () =>
  ({
    getElement: () => ({ inlineStyles: {} }),
    serialize: () => "<html></html>",
    batch: (fn: () => void) => fn(),
    setTiming: vi.fn(),
    dispatch: vi.fn(),
  }) as never;

const makeDeps = () =>
  ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: { current: 0 },
  }) as never;

describe("dark-launch gate — STUDIO_SDK_CUTOVER_ENABLED=false ⇒ persist returns false", () => {
  it("sdkTimingPersist falls back without writing", async () => {
    const deps = makeDeps();
    expect(await sdkTimingPersist("hf-a", "/c.html", { start: 1 }, makeSession(), deps)).toBe(
      false,
    );
    expect(
      (deps as unknown as { writeProjectFile: ReturnType<typeof vi.fn> }).writeProjectFile,
    ).not.toHaveBeenCalled();
  });

  it("sdkGsapTweenPersist (shared GSAP-op chokepoint) falls back", async () => {
    expect(
      await sdkGsapTweenPersist(
        "/c.html",
        { kind: "remove", animationId: "a" },
        makeSession(),
        makeDeps(),
      ),
    ).toBe(false);
  });

  it("sdkDeletePersist falls back", async () => {
    expect(
      await sdkDeletePersist("hf-a", "<html></html>", "/c.html", makeSession(), makeDeps()),
    ).toBe(false);
  });
});
