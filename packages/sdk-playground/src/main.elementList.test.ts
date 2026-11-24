// @vitest-environment jsdom
import pageHtml from "../index.html?raw";
import { afterAll, expect, it, vi } from "vitest";

const MARKUP = "<img src=x onerror=alert(1)>";
const COMPOSITION = `<div data-hf-id="hf-stage" data-hf-root data-duration="2"><div data-hf-id='${MARKUP}'>${MARKUP.replace(/</g, "&lt;")}</div></div>`;

vi.mock("gsap/dist/gsap.min.js?raw", () => ({ default: "" }));
vi.mock("./fileAdapter.js", () => ({
  createFileAdapter: () =>
    Promise.resolve({
      initialHtml: COMPOSITION,
      adapter: {
        read: () => Promise.resolve(COMPOSITION),
        write: () => Promise.resolve(),
        flush: () => Promise.resolve(),
        listVersions: () => Promise.resolve([]),
        loadFrom: () => Promise.resolve(undefined),
        on: () => () => {},
      },
    }),
}));

// main.js opens the editor on load: the page goes in first, and the SDK load stays out of the test time.
document.documentElement.innerHTML = pageHtml;
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
  },
);
const listeners = vi.spyOn(window, "addEventListener");
await import("./main.js");

afterAll(() => {
  for (const [type, listener] of listeners.mock.calls) window.removeEventListener(type, listener);
  listeners.mockRestore();
  vi.unstubAllGlobals();
  document.documentElement.innerHTML = "";
});

it("shows composition ids and text in the element list as literal text", async () => {
  const list = document.getElementById("element-list")!;
  const item = await vi.waitFor(() => {
    const found = [...list.querySelectorAll(".el-item")].find(
      (row) => row.querySelector(".el-id")?.textContent === MARKUP,
    );
    if (!found) throw new Error("element row not rendered");
    return found;
  });
  expect(item.querySelector(".el-tag")?.textContent).toBe("<div>");
  expect(item.querySelector(".el-id")?.textContent).toBe(MARKUP);
  expect(item.querySelector(".el-text")?.textContent).toBe(MARKUP);
  expect(item.children).toHaveLength(3);
  expect(document.body.querySelector("img")).toBeNull();
});
