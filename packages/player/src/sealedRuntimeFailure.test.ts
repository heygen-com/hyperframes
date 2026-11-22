import { afterEach, expect, it, vi } from "vitest";

vi.mock("@hyperframes/core/runtime-script", () => ({
  getHyperframeRuntimeScript: () => {
    throw new Error("chunk missing");
  },
}));

afterEach(() => document.body.replaceChildren());

it("names a runtime that failed to load instead of showing a sealed frame that never plays", async () => {
  await import("./hyperframes-player.js");
  const el = document.createElement("hyperframes-player");
  el.setAttribute("sandbox-origin", "");
  el.setAttribute("srcdoc", "<!doctype html><html><head></head><body></body></html>");
  const errors: string[] = [];
  el.addEventListener("error", (event: Event) =>
    errors.push((event as CustomEvent<{ message: string }>).detail.message),
  );
  document.body.appendChild(el);

  await vi.waitFor(() =>
    expect(errors).toEqual(["The HyperFrames runtime this player ships with failed to load"]),
  );
});
