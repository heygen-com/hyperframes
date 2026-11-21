// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewRequest: request,
}));

import { sealedMotionPathHome } from "./useMotionPathData";

const HOME = { x: 60, y: 45, w: 100, h: 50, ax: 0.5, ay: 0.5 };

afterEach(() => request.mockReset());

it("holds a well-formed home from the frame", async () => {
  request.mockResolvedValue({ home: HOME, perspective: 2, visible: true, plugin: true });

  const read = await sealedMotionPathHome(document.createElement("iframe"), "#box");

  expect(read).toEqual({ home: HOME, perspective: 2, visible: true, plugin: true });
});

it.each([
  ["a field that is text", { ...HOME, x: "60" }],
  ["a field that is not finite", { ...HOME, y: Number.NaN }],
  ["an endless size", { ...HOME, w: Number.POSITIVE_INFINITY }],
])("counts a home with %s as no home", async (_name, home) => {
  request.mockResolvedValue({ home, perspective: Number.NaN, visible: true, plugin: true });

  const read = await sealedMotionPathHome(document.createElement("iframe"), "#box");

  expect(read).toEqual({ home: null, perspective: 1, visible: true, plugin: true });
});

it("answers nothing for a reply that is off its shape", async () => {
  request.mockResolvedValue({ home: HOME, perspective: 1, visible: "yes", plugin: true });

  expect(await sealedMotionPathHome(document.createElement("iframe"), "#box")).toBeNull();
});
