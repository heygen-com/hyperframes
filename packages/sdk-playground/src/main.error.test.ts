// @vitest-environment jsdom
import pageHtml from "../index.html?raw";
import { expect, it, vi } from "vitest";

vi.mock("@hyperframes/sdk", () => ({ openComposition: vi.fn() }));
vi.mock("@hyperframes/core/gsap-parser-acorn", () => ({ parseGsapScriptAcorn: vi.fn() }));
vi.mock("gsap/dist/gsap.min.js?raw", () => ({ default: "" }));
vi.mock("./fileAdapter.js", () => ({
  createFileAdapter: () => Promise.reject(new Error('<img src=x onerror="alert(1)"> & failed')),
}));

it("shows initialization errors as literal text without creating attacker markup", async () => {
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
    await vi.waitFor(() => expect(document.querySelector("pre")).not.toBeNull());
    expect(document.body.textContent).toBe('Error: <img src=x onerror="alert(1)"> & failed');
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.children).toHaveLength(1);
    expect(document.querySelector("pre")?.style.padding).toBe("20px");
  } finally {
    for (const [type, listener] of listeners.mock.calls) window.removeEventListener(type, listener);
    listeners.mockRestore();
    vi.unstubAllGlobals();
    document.documentElement.innerHTML = "";
  }
});
