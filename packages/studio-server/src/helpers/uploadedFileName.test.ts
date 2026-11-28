import { describe, expect, it } from "vitest";
import { savesUnderItsOwnName, uploadedFileName } from "./uploadedFileName.js";

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

describe("savesUnderItsOwnName", () => {
  it("refuses a name ending in a dot or a space, which Windows would save under another name", () => {
    for (const name of ["clip.", "clip...", "clip. ", "clip ", "clip.mp3 ", "..."]) {
      expect(savesUnderItsOwnName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("refuses a Windows device name, in any case and with any extension", () => {
    for (const name of [
      "CON",
      "con.mp3",
      "NUL.tar.gz",
      "Aux.wav",
      "prn .txt",
      "com1.mp4",
      "LPT9.png",
    ]) {
      expect(savesUnderItsOwnName(name), name).toBe(false);
    }
  });

  it("refuses the superscript COM and LPT device names and the console devices", () => {
    const names = ["com¹", "COM².txt", "com³.mp3", "lpt¹.png", "LPT²", "LPT³.wav"];
    for (const name of [...names, "CONIN$", "conin$.mp3", "CONOUT$", "Conout$.tar.gz"]) {
      expect(savesUnderItsOwnName(name), name).toBe(false);
    }
  });

  it("keeps names that only start like a device name or hold dots inside", () => {
    for (const name of [
      "console.mp3",
      "nullable.png",
      "com10.mp4",
      "lpt0.wav",
      "com⁴.mp3",
      "coninput.txt",
      "conout.mp3",
      "Cartoon_Falling....mp3",
      ".gitignore",
      "a. b.mp3",
    ]) {
      expect(savesUnderItsOwnName(name), name).toBe(true);
    }
  });

  it("refuses a colon on Windows, where it names a drive or a file stream", () => {
    for (const name of ["C:foo.mp3", "a.mp3:x"]) {
      expect(savesUnderItsOwnName(name, "win32")).toBe(false);
      expect(savesUnderItsOwnName(name, "linux")).toBe(true);
      expect(savesUnderItsOwnName(name, "darwin")).toBe(true);
    }
  });
});
