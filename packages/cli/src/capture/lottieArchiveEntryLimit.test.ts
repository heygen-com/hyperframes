import { describe, expect, it, vi } from "vitest";
import { readLottieArchive } from "./lottieValidation.js";

const getEntries = vi.hoisted(() => vi.fn(() => []));
vi.mock("adm-zip", () => ({
  default: class {
    getEntryCount() {
      return 1000;
    }
    getEntries = getEntries;
  },
}));

describe("Lottie archive entry allocation", () => {
  it("rejects the EOCD count without materializing entries", () => {
    expect(readLottieArchive(Buffer.from("archive metadata supplied by test"))).toBeNull();
    expect(getEntries).not.toHaveBeenCalled();
  });
});
