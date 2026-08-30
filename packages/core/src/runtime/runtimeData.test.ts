import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeData,
  registerRuntimeDataHandler,
  resetRuntimeDataForTests,
  setRuntimeData,
  setRuntimeDataAppliedReporter,
  setRuntimeDataErrorReporter,
} from "./runtimeData";

describe("runtime data registry", () => {
  beforeEach(resetRuntimeDataForTests);

  it("delivers retained data when the handler registers later", () => {
    const handler = vi.fn();
    setRuntimeData("captions", { words: ["before"] });
    registerRuntimeDataHandler("captions", handler);
    expect(handler).toHaveBeenCalledWith({ words: ["before"] });
  });

  it("replaces handlers and keeps channels isolated", () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    const other = vi.fn();
    registerRuntimeDataHandler("captions", oldHandler);
    registerRuntimeDataHandler("captions", newHandler);
    registerRuntimeDataHandler("telemetry", other);
    setRuntimeData("captions", { words: ["latest"] });
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  it("notifies the current handler with undefined when cleared", () => {
    const handler = vi.fn();
    registerRuntimeDataHandler("captions", handler);
    setRuntimeData("captions", { words: [] });
    clearRuntimeData("captions");
    expect(handler).toHaveBeenLastCalledWith(undefined);
    const replacement = vi.fn();
    registerRuntimeDataHandler("captions", replacement);
    expect(replacement).not.toHaveBeenCalled();
  });

  it("reports handler exceptions without breaking later delivery", () => {
    const reporter = vi.fn();
    setRuntimeDataErrorReporter(reporter);
    registerRuntimeDataHandler("captions", () => {
      throw new Error("attach failed");
    });
    expect(() => setRuntimeData("captions", {})).not.toThrow();
    expect(reporter).toHaveBeenCalledWith("captions", expect.any(Number), expect.any(Error));
  });

  it("reports asynchronous completion and rejection", async () => {
    const applied = vi.fn();
    const failed = vi.fn();
    setRuntimeDataAppliedReporter(applied);
    setRuntimeDataErrorReporter(failed);
    registerRuntimeDataHandler("captions", async (payload) => {
      await Promise.resolve();
      if (payload === "bad") throw new Error("async attach failed");
    });

    setRuntimeData("captions", "good");
    await vi.waitFor(() => expect(applied).toHaveBeenCalledWith("captions", expect.any(Number)));
    setRuntimeData("captions", "bad");
    await vi.waitFor(() =>
      expect(failed).toHaveBeenCalledWith("captions", expect.any(Number), expect.any(Error)),
    );
  });

  it("reports only the latest concurrent delivery on a channel", async () => {
    const applied = vi.fn();
    setRuntimeDataAppliedReporter(applied);
    const resolvers: Array<() => void> = [];
    registerRuntimeDataHandler(
      "captions",
      () => new Promise<void>((resolve) => resolvers.push(resolve)),
    );

    setRuntimeData("captions", "first", 101);
    setRuntimeData("captions", "latest", 102);
    resolvers[1]?.();
    await vi.waitFor(() => expect(applied).toHaveBeenCalledWith("captions", 102));
    resolvers[0]?.();
    await Promise.resolve();

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("never reports a composition-side delivery under a pending host request id", async () => {
    const applied = vi.fn();
    setRuntimeDataAppliedReporter(applied);
    const resolvers: Array<() => void> = [];
    registerRuntimeDataHandler(
      "captions",
      () => new Promise<void>((resolve) => resolvers.push(resolve)),
    );

    // The host mints id 1 and waits on it; the composition then calls the two-argument
    // public form, which mints an id of its own.
    setRuntimeData("captions", "first", 1);
    setRuntimeData("captions", "latest");
    resolvers[1]?.();
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(1));

    const [, reportedId] = applied.mock.calls[0] ?? [];
    expect(reportedId).not.toBe(1);
  });
});
