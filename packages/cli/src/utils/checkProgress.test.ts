import { afterEach, expect, it, vi } from "vitest";
import { logCheckProgress } from "./checkProgress.js";

afterEach(() => vi.restoreAllMocks());

it("writes one stderr line naming the stage and the count", () => {
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  logCheckProgress("samples", 3, 12);
  expect(stderr).toHaveBeenCalledWith("[hyperframes] check: samples 3/12");
});
