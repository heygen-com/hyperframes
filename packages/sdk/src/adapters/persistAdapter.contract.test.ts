/**
 * T13 — PersistAdapter contract suite
 *
 * Parameterized over adapter implementations. Every adapter (memory, fs, S3, HTTP)
 * runs the same suite automatically — write once, protect all.
 *
 * Run against the memory adapter immediately; future implementations:
 *   runPersistAdapterContract("fs", () => createFsAdapter({ root: tmpDir }))
 *   runPersistAdapterContract("s3", () => createS3Adapter({ bucket, prefix }))
 */

import { describe, it, expect, vi } from "vitest";
import { createMemoryAdapter } from "./memory.js";
import type { PersistAdapter } from "./types.js";

export function runPersistAdapterContract(
  label: string,
  createAdapter: () => PersistAdapter,
): void {
  describe(`PersistAdapter contract — ${label}`, () => {
    it("read returns undefined for a path never written", async () => {
      const adapter = createAdapter();
      expect(await adapter.read("missing.html")).toBeUndefined();
    });

    it("write then read returns the written content", async () => {
      const adapter = createAdapter();
      await adapter.write("comp.html", "<html></html>");
      expect(await adapter.read("comp.html")).toBe("<html></html>");
    });

    it("second write overwrites the first", async () => {
      const adapter = createAdapter();
      await adapter.write("comp.html", "v1");
      await adapter.write("comp.html", "v2");
      expect(await adapter.read("comp.html")).toBe("v2");
    });

    it("flush() returns after any pending writes are committed", async () => {
      const adapter = createAdapter();
      // Write without awaiting to exercise the queue path
      void adapter.write("comp.html", "queued");
      await adapter.flush();
      expect(await adapter.read("comp.html")).toBe("queued");
    });

    it("listVersions returns entries in reverse-chronological order", async () => {
      const adapter = createAdapter();
      await adapter.write("comp.html", "v1");
      await adapter.write("comp.html", "v2");
      await adapter.write("comp.html", "v3");
      const versions = await adapter.listVersions("comp.html");
      expect(versions.length).toBeGreaterThanOrEqual(3);
      // Newest first
      expect(versions[0]?.content).toBe("v3");
      expect(versions[versions.length - 1]?.content).toBe("v1");
    });

    it("loadFrom restores the model to that version's content", async () => {
      const adapter = createAdapter();
      await adapter.write("comp.html", "v1");
      const versions = await adapter.listVersions("comp.html");
      const firstKey = versions[versions.length - 1]?.key;
      expect(firstKey).toBeDefined();
      await adapter.write("comp.html", "v2");
      const restored = await adapter.loadFrom("comp.html", firstKey!);
      expect(restored).toBe("v1");
    });

    it("listVersions returns empty array for a path never written", async () => {
      const adapter = createAdapter();
      expect(await adapter.listVersions("missing.html")).toEqual([]);
    });

    it("loadFrom returns undefined for an unknown version key", async () => {
      const adapter = createAdapter();
      await adapter.write("comp.html", "content");
      expect(await adapter.loadFrom("comp.html", "nonexistent-key")).toBeUndefined();
    });

    it("on('persist:error') fires when a write fails; error is not thrown", async () => {
      // This test uses the injectFault() test helper if available.
      // For adapters without fault injection, skip with a note.
      const adapter = createAdapter();
      const hasInjectFault =
        "injectFault" in adapter &&
        typeof (adapter as { injectFault: unknown }).injectFault === "function";

      if (!hasInjectFault) {
        // Adapter does not expose fault injection — skip execution
        // (test still runs to document the contract; real adapters must implement this)
        return;
      }

      const onError = vi.fn();
      adapter.on("persist:error", onError);
      (adapter as { injectFault(m: string): void }).injectFault("network error");

      await adapter.write("comp.html", "content");

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: "network error" }),
        }),
      );
    });

    it("unsubscribe returned by on() removes the listener", async () => {
      const adapter = createAdapter();
      const onError = vi.fn();
      const unsub = adapter.on("persist:error", onError);
      unsub();

      // Fire an error if possible
      if (
        "injectFault" in adapter &&
        typeof (adapter as { injectFault: unknown }).injectFault === "function"
      ) {
        (adapter as { injectFault(m: string): void }).injectFault("err");
        await adapter.write("comp.html", "x");
        expect(onError).not.toHaveBeenCalled();
      }
    });
  });
}

// Run the suite against the memory adapter immediately
runPersistAdapterContract("memory", createMemoryAdapter);
