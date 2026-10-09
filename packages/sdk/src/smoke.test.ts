/**
 * SDK smoke test — end-to-end pipeline.
 *
 * Exercises the full public surface: openComposition → mutate → applyPatches →
 * serialize round-trip, plus batch transactionality, history undo, persist
 * adapter, and patch subscription.
 *
 * This file is the "golden example" pinned as a regression smoke test.
 * If it breaks, the SDK's public contract has changed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  openComposition,
  ORIGIN_APPLY_PATCHES,
  resolveScoped,
  findById,
  escapeHfId,
  readVariableDefault,
  buildDocument,
} from "./index.js";
import { createMemoryAdapter } from "./adapters/memory.js";

// ─── Fixture ─────────────────────────────────────────────────────────────────

const BASE_HTML = `
<!DOCTYPE html>
<html>
<head></head>
<body>
<div id="stage" data-hf-root data-width="1920" data-height="1080" data-duration="5">
  <h1 id="title" data-hf-id="hf-title" data-start="0" data-end="3"
      style="color: #fff; font-size: 64px">Hello World</h1>
  <img id="logo" data-hf-id="hf-logo" src="/logo.png" alt="Logo"
       data-x="100" data-y="200" data-start="0" data-end="5" />
  <p id="body-copy" data-hf-id="hf-body" data-start="1" data-end="4"
     style="font-size: 24px">Body copy</p>
</div>
</body>
</html>
`.trim();

// ─── init → mutate → serialize ────────────────────────────────────────────────

describe("fragment document detection", () => {
  it.each([
    `<!-- Example: <html> --><div data-hf-root><p data-hf-id="hf-title">Hello</p></div>`,
    `<!-- Example: <!doctype html> --><div data-hf-root><p data-hf-id="hf-title">Hello</p></div>`,
    `<div data-hf-root title="<html>"><p data-hf-id="hf-title">Hello</p></div>`,
  ])("models and edits a fragment containing inert document markers: %s", async (html) => {
    const snapshot = buildDocument(html);
    expect(snapshot.roots).toHaveLength(1);
    expect(snapshot.roots[0]?.children[0]?.id).toBe("hf-title");
    const comp = await openComposition(html);
    expect(comp.getElement("hf-title")?.text).toBe("Hello");
    comp.setText("hf-title", "Edited");
    const serialized = comp.serialize();
    expect(serialized).toContain("Edited");
    expect(serialized).not.toContain("<body>");
    const reopened = await openComposition(serialized);
    expect(reopened.getElement("hf-title")?.text).toBe("Edited");
    comp.dispose();
    reopened.dispose();
  });
});

describe("openComposition + basic mutations", () => {
  it("opens without error and exposes element snapshots", async () => {
    const comp = await openComposition(BASE_HTML);
    const els = comp.getElements();
    expect(els.length).toBeGreaterThanOrEqual(3);
    const title = comp.getElement("hf-title");
    expect(title).not.toBeNull();
    expect(title?.inlineStyles.color).toBe("#fff");
  });

  it("setStyle mutates inline styles and serializes back to HTML", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#f00", fontSize: "96px" });
    const html = comp.serialize();
    expect(html).toContain("color: #f00");
    expect(html).toContain("font-size: 96px");
  });

  it("element handle sugar — same result as direct setStyle", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.element("hf-title").setStyle({ color: "#0f0" });
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#0f0");
  });

  it("setText updates text content", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setText("hf-title", "Goodbye World");
    expect(comp.getElement("hf-title")?.text).toContain("Goodbye World");
    expect(comp.serialize()).toContain("Goodbye World");
  });

  it("dispatch moveElement writes data-x/data-y attributes", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.dispatch({ type: "moveElement", target: "hf-logo", x: 300, y: 400 });
    const el = comp.getElement("hf-logo");
    expect(el?.attributes["data-x"]).toBe("300");
    expect(el?.attributes["data-y"]).toBe("400");
  });

  it("serialize round-trip: mutate → serialize → reopen → same state", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#0f0" });
    comp.setText("hf-body", "Round-tripped");
    const html = comp.serialize();

    const comp2 = await openComposition(html);
    expect(comp2.getElement("hf-title")?.inlineStyles.color).toBe("#0f0");
    expect(comp2.getElement("hf-body")?.text).toContain("Round-tripped");
  });
});

// ─── patch subscription ───────────────────────────────────────────────────────

describe("patch events", () => {
  it("emits a patch event per dispatch with correct path and value", async () => {
    const comp = await openComposition(BASE_HTML);
    const events: unknown[] = [];
    comp.on("patch", (e) => events.push(e));

    comp.setStyle("hf-title", { fontSize: "48px" });

    expect(events).toHaveLength(1);
    const event = events[0] as { patches: { path: string; value: unknown }[] };
    const patch = event.patches.find((p) => p.path.endsWith("/fontSize"));
    expect(patch?.value).toBe("48px");
  });

  it("applyPatches origin is tagged ORIGIN_APPLY_PATCHES", async () => {
    const comp = await openComposition(BASE_HTML);
    const origins: unknown[] = [];
    comp.on("patch", (e) => origins.push((e as { origin: unknown }).origin));

    comp.applyPatches([
      { op: "replace", path: "/elements/hf-title/inlineStyles/color", value: "#00f" },
    ]);

    expect(origins[0]).toBe(ORIGIN_APPLY_PATCHES);
  });
});

// ─── applyPatches ─────────────────────────────────────────────────────────────

describe("applyPatches", () => {
  it("applies external RFC 6902 patches to the live document", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.applyPatches([
      { op: "replace", path: "/elements/hf-title/inlineStyles/color", value: "#00f" },
      { op: "replace", path: "/elements/hf-title/text", value: "Patched" },
    ]);
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#00f");
    expect(comp.getElement("hf-title")?.text).toContain("Patched");
  });

  it("applyPatches does NOT enter undo history — undo() is a no-op", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.applyPatches([
      { op: "replace", path: "/elements/hf-title/inlineStyles/color", value: "#00f" },
    ]);
    comp.undo(); // no-op: applyPatches bypasses history
    // color must still be the patched value (undo had nothing to revert)
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#00f");
  });
});

// ─── batch transactionality ───────────────────────────────────────────────────

describe("batch()", () => {
  it("coalesces multiple dispatches into one patch event", async () => {
    const comp = await openComposition(BASE_HTML);
    const events: unknown[] = [];
    comp.on("patch", (e) => events.push(e));

    comp.batch(() => {
      comp.setStyle("hf-title", { color: "#f00" });
      comp.setText("hf-body", "Batched");
    });

    expect(events).toHaveLength(1);
  });

  it("rolls back DOM on throw — model unchanged after throwing batch", async () => {
    const comp = await openComposition(BASE_HTML);
    const beforeColor = comp.getElement("hf-title")?.inlineStyles.color;

    try {
      comp.batch(() => {
        comp.setStyle("hf-title", { color: "#f00" });
        throw new Error("user cancelled");
      });
    } catch {
      // expected
    }

    // DOM must be exactly as before
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe(beforeColor);
  });

  it("throwing batch does NOT add a history entry — undo is a no-op", async () => {
    const comp = await openComposition(BASE_HTML);
    try {
      comp.batch(() => {
        comp.setStyle("hf-title", { color: "#f00" });
        throw new Error("rollback");
      });
    } catch {
      // expected
    }
    // undo should be a no-op since no history entry was added
    comp.undo();
    // color should still be the original (batch was rolled back + undo had nothing to do)
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#fff");
  });
});

// ─── history ─────────────────────────────────────────────────────────────────

describe("undo / redo", () => {
  it("undo reverts last mutation, redo re-applies it", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#f00" });
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#f00");

    comp.undo();
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#fff");

    comp.redo();
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#f00");
  });

  it("undo with no history is a no-op", async () => {
    const comp = await openComposition(BASE_HTML);
    const before = comp.getElement("hf-title")?.inlineStyles.color;
    comp.undo(); // no-op
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe(before);
  });
});

// ─── persist adapter ─────────────────────────────────────────────────────────

describe("persist adapter", () => {
  function deferredSave() {
    const adapter = createMemoryAdapter();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { adapter, write: adapter.write.bind(adapter), gate, release: () => release() };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes storage without writing a new version when no edit is pending", async () => {
    const adapter = createMemoryAdapter();
    const writeSpy = vi.spyOn(adapter, "write");
    const flushSpy = vi.spyOn(adapter, "flush");
    const comp = await openComposition(BASE_HTML, { persist: adapter });

    await comp.flush();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(flushSpy).toHaveBeenCalledOnce();
    expect(await adapter.listVersions("composition.html")).toEqual([]);
    comp.dispose();
  });

  it("does not duplicate a saved edit on repeated flushes", async () => {
    const adapter = createMemoryAdapter();
    const writeSpy = vi.spyOn(adapter, "write");
    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.setText("hf-title", "Saved once");

    await comp.flush();
    await comp.flush();
    await comp.flush();
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(await adapter.listVersions("composition.html")).toHaveLength(1);
    comp.dispose();
  });

  it("commits an adapter's buffered save before flush resolves", async () => {
    const adapter = createMemoryAdapter();
    const write = adapter.write.bind(adapter);
    const pending: Array<{ path: string; content: string }> = [];
    vi.spyOn(adapter, "write").mockImplementation(async (path, content) => {
      pending.push({ path, content });
    });
    const flushSpy = vi.spyOn(adapter, "flush").mockImplementation(async () => {
      for (const save of pending.splice(0)) await write(save.path, save.content);
    });
    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.setText("hf-title", "Durably saved");

    await comp.flush();
    expect(flushSpy).toHaveBeenCalledOnce();
    expect(pending).toEqual([]);
    expect(await adapter.read("composition.html")).toContain("Durably saved");
    comp.dispose();
  });

  it("waits for an in-flight autosave without queuing another copy", async () => {
    vi.useFakeTimers();
    const { adapter, write, gate, release } = deferredSave();
    const writeSpy = vi.spyOn(adapter, "write").mockImplementation(async (path, content) => {
      await gate;
      await write(path, content);
    });
    const flushSpy = vi.spyOn(adapter, "flush");
    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.setText("hf-title", "In flight");
    await vi.advanceTimersByTimeAsync(0);

    let settled = false;
    const flushing = comp.flush().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(flushSpy).not.toHaveBeenCalled();
    release();
    await flushing;
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(flushSpy).toHaveBeenCalledOnce();
    expect(await adapter.read("composition.html")).toContain("In flight");
    comp.dispose();
  });

  it("keeps adapter flushes and later saves in order", async () => {
    vi.useFakeTimers();
    const { adapter, write, gate, release } = deferredSave();
    const events: string[] = [];
    vi.spyOn(adapter, "write").mockImplementation(async (path, content) => {
      events.push(content.includes("First edit") ? "write:first" : "write:second");
      await write(path, content);
    });
    vi.spyOn(adapter, "flush").mockImplementationOnce(async () => {
      events.push("flush:start");
      await gate;
      events.push("flush:end");
    });
    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.setText("hf-title", "First edit");
    const first = comp.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(["write:first", "flush:start"]);

    comp.setText("hf-title", "Second edit");
    const second = comp.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(["write:first", "flush:start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["write:first", "flush:start", "flush:end", "write:second"]);
    expect(await adapter.read("composition.html")).toContain("Second edit");
    comp.dispose();
  });

  it("reports an adapter flush failure and permits the next save", async () => {
    const adapter = createMemoryAdapter();
    vi.spyOn(adapter, "flush").mockRejectedValueOnce(new Error("storage unavailable"));
    const comp = await openComposition(BASE_HTML, { persist: adapter });
    const onError = vi.fn();
    comp.on("persist:error", onError);
    comp.setText("hf-title", "First save");

    await expect(comp.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith({
      error: { message: "storage unavailable", cause: expect.any(Error) },
    });
    comp.setText("hf-title", "Recovered save");
    await comp.flush();
    expect(await adapter.read("composition.html")).toContain("Recovered save");
    expect(onError).toHaveBeenCalledOnce();
    comp.dispose();
  });

  it("writes serialized HTML to the adapter on mutation", async () => {
    const adapter = createMemoryAdapter();
    const writeSpy = vi.spyOn(adapter, "write");

    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.setStyle("hf-title", { color: "#f00" });
    await comp.flush();

    expect(writeSpy).toHaveBeenCalled();
    const [, content] = writeSpy.mock.calls[0] as [string, string];
    expect(content).toContain("color: #f00");
  });

  it("still persists when history:false (undo opt-out must not disable auto-save)", async () => {
    const adapter = createMemoryAdapter();
    const writeSpy = vi.spyOn(adapter, "write");

    const comp = await openComposition(BASE_HTML, { persist: adapter, history: false });
    expect(comp.canUndo()).toBe(false); // undo is off…
    comp.setStyle("hf-title", { color: "#f00" });
    await comp.flush();

    expect(writeSpy).toHaveBeenCalled(); // …but the write still happened
    const [, content] = writeSpy.mock.calls[0] as [string, string];
    expect(content).toContain("color: #f00");
  });

  it("surfaces persist errors via on('persist:error')", async () => {
    const adapter = createMemoryAdapter();
    const errors: unknown[] = [];

    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.on("persist:error", (e) => errors.push(e));

    adapter.injectFault("disk full");
    comp.setStyle("hf-title", { color: "#f00" });

    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toHaveLength(1);
  });

  it("defaults the write path to composition.html when persistPath is omitted", async () => {
    const adapter = createMemoryAdapter();
    const writeSpy = vi.spyOn(adapter, "write");

    const comp = await openComposition(BASE_HTML, { persist: adapter });
    comp.setStyle("hf-title", { color: "#f00" });
    await comp.flush();

    const [path] = writeSpy.mock.calls[0] as [string, string];
    expect(path).toBe("composition.html");
  });

  it("writes to persistPath when supplied", async () => {
    const adapter = createMemoryAdapter();
    const writeSpy = vi.spyOn(adapter, "write");

    const comp = await openComposition(BASE_HTML, {
      persist: adapter,
      persistPath: "scenes/intro.html",
    });
    comp.setStyle("hf-title", { color: "#f00" });
    await comp.flush();

    const [path] = writeSpy.mock.calls[0] as [string, string];
    expect(path).toBe("scenes/intro.html");
  });
});

// ─── T3 embedded mode (override-set) ─────────────────────────────────────────

describe("T3 embedded mode", () => {
  it("applies override-set on open, mutations layer on top", async () => {
    const comp = await openComposition(BASE_HTML, {
      overrides: { "hf-title.style.color": "#0f0" },
    });
    expect(comp.getElement("hf-title")?.inlineStyles.color).toBe("#0f0");
  });

  it("getOverrides() returns accumulated override-set", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#f00" });
    const overrides = comp.getOverrides();
    expect(overrides["hf-title.style.color"]).toBe("#f00");
  });

  it("serialize → reopen with overrides → same state as direct mutation", async () => {
    // Simulate host storing overrides + base template separately (T3 pattern)
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#0f0" });
    comp.setText("hf-body", "Override text");
    const overrides = comp.getOverrides();

    // Host reopens the original template with the stored overrides
    const comp2 = await openComposition(BASE_HTML, { overrides });
    expect(comp2.getElement("hf-title")?.inlineStyles.color).toBe("#0f0");
    expect(comp2.getElement("hf-body")?.text).toContain("Override text");
  });
});

describe("engine helper exports (resolveScoped, findById, escapeHfId, readVariableDefault)", () => {
  it("are importable from the public index and work against a live document", async () => {
    // These operate on a Document directly, not the Composition — exercise them
    // against a document parsed the same way the SDK parses internally.
    const { document } = await import("linkedom").then((m) => m.parseHTML(BASE_HTML));
    expect(findById(document as unknown as Document, "hf-title")).not.toBeNull();
    expect(resolveScoped(document as unknown as Document, "hf-title")).not.toBeNull();
    expect(escapeHfId('hf-"quoted"')).toBe('hf-\\"quoted\\"');
    // readVariableDefault takes the declaration element (the <html>/root), not the Document.
    const declEl = (document as unknown as Document).documentElement;
    expect(readVariableDefault(declEl, "never-declared")).toBeUndefined();
  });
});
