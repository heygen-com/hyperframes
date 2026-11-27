import { describe, expect, it } from "vitest";
import { uploadedFileName } from "./uploadedFileName.js";

describe("uploadedFileName", () => {
  it("keeps the last component of a name the browser sent with a folder", () => {
    expect(uploadedFileName("clips/intro.mp4")).toBe("intro.mp4");
    expect(uploadedFileName("clips\\intro.mp4")).toBe("intro.mp4");
  });

  // Files with a run of dots in the name were silently skipped on upload.
  it("keeps a name with a run of dots in it", () => {
    expect(uploadedFileName("Cartoon_Falling....mp3")).toBe("Cartoon_Falling....mp3");
    expect(uploadedFileName("take..2.wav")).toBe("take..2.wav");
    expect(uploadedFileName("sounds/Cartoon_Falling....mp3")).toBe("Cartoon_Falling....mp3");
  });

  it("refuses a name that is empty, holds a NUL, or is a . or .. segment", () => {
    for (const sent of ["", "clips/", "a\0b.mp4", ".", "..", "clips/..", "clips\\.."]) {
      expect(uploadedFileName(sent)).toBeNull();
    }
  });
});
