import { vi } from "vitest";

// Shared by every test that drives the real `cli.js` dispatch path
// (dynamic import + process.argv) instead of source-text matching.

export function mockTelemetry(
  overrides: {
    flushSync?: ReturnType<typeof vi.fn>;
    trackCommandResult?: ReturnType<typeof vi.fn>;
    trackCommandFailure?: ReturnType<typeof vi.fn>;
  } = {},
): void {
  vi.doMock("./telemetry/index.js", () => ({
    flush: vi.fn(async () => {}),
    flushSync: overrides.flushSync ?? vi.fn(),
    incrementCommandCount: vi.fn(),
    showTelemetryNotice: vi.fn(),
    shouldTrack: () => false,
    trackCliError: vi.fn(),
    trackCommand: vi.fn(),
    trackCommandResult: overrides.trackCommandResult ?? vi.fn(),
  }));
  vi.doMock("./telemetry/events.js", () => ({
    trackCommandFailure: overrides.trackCommandFailure ?? vi.fn(),
  }));
}
