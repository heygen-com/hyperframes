// @vitest-environment jsdom
import pageHtml from "../index.html?raw";
import { expect, it, vi } from "vitest";

// Keep initialization at the asynchronous persistence boundary while exercising
// the real static UI and its registered message listener.
// The paused initializer never opens a composition. Keep unrelated SDK/parser
// and raw animation-library transforms out of this message-boundary witness.
vi.mock("@hyperframes/sdk", () => ({ openComposition: vi.fn() }));
vi.mock("@hyperframes/core/gsap-parser-acorn", () => ({ parseGsapScriptAcorn: vi.fn() }));
vi.mock("gsap/dist/gsap.min.js?raw", () => ({ default: "" }));
vi.mock("./fileAdapter.js", () => ({
  createFileAdapter: () => new Promise(() => {}),
}));

it("accepts only current-preview messages with registered string types", async () => {
  document.documentElement.innerHTML = pageHtml;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  const listeners = vi.spyOn(window, "addEventListener");
  try {
    await import("./main.js");
    const handler = listeners.mock.calls.find(([type]) => type === "message")?.[1];
    if (typeof handler !== "function") throw new Error("Message listener not installed");
    const frame = document.getElementById("preview-frame") as HTMLIFrameElement;
    const original = frame.contentWindow;
    const send = (source: MessageEventSource | null, data: unknown) =>
      handler.call(window, new MessageEvent("message", { source, data }));
    send(original, { type: "hf:duration", duration: 12 });
    expect(document.getElementById("tl-dur")!.textContent).toBe("12.0s");
    for (const source of [window, null]) send(source, { type: "hf:duration", duration: 99 });
    expect(document.getElementById("tl-dur")!.textContent).toBe("12.0s");
    for (const type of [
      "__proto__",
      "constructor",
      "hasOwnProperty",
      "__defineGetter__",
      "toString",
      "unknown",
      ["hf:duration"],
      null,
    ]) {
      expect(() => send(original, { type, duration: 99 })).not.toThrow();
    }
    expect(document.getElementById("tl-dur")!.textContent).toBe("12.0s");
    const replacement = document.createElement("iframe");
    replacement.id = frame.id;
    frame.replaceWith(replacement);
    send(original, { type: "hf:duration", duration: 99 });
    expect(document.getElementById("tl-dur")!.textContent).toBe("12.0s");
    send(replacement.contentWindow, { type: "hf:time", time: 3 });
    expect(document.getElementById("tl-time")!.textContent).toBe("3.0s");
    window.removeEventListener("message", handler);
  } finally {
    listeners.mockRestore();
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = "";
  }
});
