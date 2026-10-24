import { describe, expect, it } from "vitest";
import { createMemoryAdapter, openComposition } from "./index.js";

const HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 320px; height: 180px" data-duration="1">
  <h1 data-hf-id="hf-title">Owned title</h1>
</div>
`.trim();

async function emitError(adapter: ReturnType<typeof createMemoryAdapter>, message: string) {
  adapter.injectFault(message);
  await adapter.write("owned.html", "owned");
}

describe("session persistence subscription cleanup", () => {
  it("stops persistence error callbacks after disposal", async () => {
    const adapter = createMemoryAdapter();
    const comp = await openComposition(HTML, { persist: adapter });
    const messages: string[] = [];
    comp.on("persist:error", ({ error }) => messages.push(error.message));
    try {
      await emitError(adapter, "before");
      expect(messages).toEqual(["before"]);
      comp.dispose();
      await emitError(adapter, "after");
      expect(messages).toEqual(["before"]);
    } finally {
      comp.dispose();
    }
  });

  it("cleans every registration and permits repeated disposal and unsubscribe", async () => {
    const adapter = createMemoryAdapter();
    const comp = await openComposition(HTML, { persist: adapter });
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = comp.on("persist:error", ({ error }) => first.push(error.message));
    const offSecond = comp.on("persist:error", ({ error }) => second.push(error.message));
    try {
      await emitError(adapter, "before");
      comp.dispose();
      comp.dispose();
      await emitError(adapter, "after-dispose");
      offFirst();
      offFirst();
      offSecond();
      await emitError(adapter, "after-unsubscribe");
      expect({ first, second }).toEqual({ first: ["before"], second: ["before"] });
    } finally {
      comp.dispose();
    }
  });

  it("preserves live and newly opened sessions on the shared adapter", async () => {
    const adapter = createMemoryAdapter();
    const disposed = await openComposition(HTML, { persist: adapter });
    const live = await openComposition(HTML, { persist: adapter });
    const disposedMessages: string[] = [];
    const liveMessages: string[] = [];
    const newMessages: string[] = [];
    disposed.on("persist:error", ({ error }) => disposedMessages.push(error.message));
    live.on("persist:error", ({ error }) => liveMessages.push(error.message));
    let newlyOpened: Awaited<ReturnType<typeof openComposition>> | undefined;
    try {
      await emitError(adapter, "before");
      disposed.dispose();
      newlyOpened = await openComposition(HTML, { persist: adapter });
      newlyOpened.on("persist:error", ({ error }) => newMessages.push(error.message));
      await emitError(adapter, "after");
      expect({ disposedMessages, liveMessages, newMessages }).toEqual({
        disposedMessages: ["before"],
        liveMessages: ["before", "after"],
        newMessages: ["after"],
      });
    } finally {
      disposed.dispose();
      live.dispose();
      newlyOpened?.dispose();
    }
  });

  it("does not unsubscribe another session using the same handler twice", async () => {
    const adapter = createMemoryAdapter();
    const first = await openComposition(HTML, { persist: adapter });
    const second = await openComposition(HTML, { persist: adapter });
    const messages: string[] = [];
    const handler = ({ error }: { error: { message: string } }) => messages.push(error.message);
    const offFirst = first.on("persist:error", handler);
    second.on("persist:error", handler);
    try {
      await emitError(adapter, "both");
      expect(messages).toEqual(["both", "both"]);
      offFirst();
      offFirst();
      await emitError(adapter, "second-only");
      expect(messages).toEqual(["both", "both", "second-only"]);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("allows explicit unsubscribe before disposal without further callbacks", async () => {
    const adapter = createMemoryAdapter();
    const comp = await openComposition(HTML, { persist: adapter });
    const messages: string[] = [];
    const off = comp.on("persist:error", ({ error }) => messages.push(error.message));
    try {
      await emitError(adapter, "before");
      off();
      off();
      await emitError(adapter, "after-unsubscribe");
      comp.dispose();
      off();
      await emitError(adapter, "after-dispose");
      expect(messages).toEqual(["before"]);
    } finally {
      comp.dispose();
    }
  });

  it("preserves a direct adapter subscription when a session is disposed", async () => {
    const adapter = createMemoryAdapter();
    const comp = await openComposition(HTML, { persist: adapter });
    const messages: string[] = [];
    const offAdapter = adapter.on("persist:error", ({ error }) => messages.push(error.message));
    comp.on("persist:error", () => {});
    try {
      comp.dispose();
      await emitError(adapter, "adapter-owned");
      expect(messages).toEqual(["adapter-owned"]);
    } finally {
      comp.dispose();
      offAdapter();
    }
  });

  it("reports a live autosave error and recovers on the next flushed edit", async () => {
    const adapter = createMemoryAdapter();
    const comp = await openComposition(HTML, { persist: adapter });
    const messages: string[] = [];
    comp.on("persist:error", ({ error }) => messages.push(error.message));
    try {
      adapter.injectFault("failed save");
      comp.setText("hf-title", "failed");
      await comp.flush();
      expect(messages).toEqual(["failed save"]);
      expect(await adapter.read("composition.html")).toBeUndefined();
      comp.setText("hf-title", "recovered");
      await comp.flush();
      expect(await adapter.read("composition.html")).toContain("recovered");
      expect(messages).toEqual(["failed save"]);
    } finally {
      comp.dispose();
    }
  });
});
