import { describe, expect, it } from "vitest";
import { faceSummary, faceVerdict } from "./face.js";

describe("faces", () => {
  it("grades the subject's face by its height", () => {
    expect(faceVerdict(0.3)).toBe("pass");
    expect(faceVerdict(0.1)).toBe("warn");
    expect(faceVerdict(0.1, true)).toBe("fail");
    expect(faceVerdict(null)).toBe("unmeasured");
    const r = faceSummary([
      {
        frame: 0,
        t: 0,
        boxes: [
          [0.4, 0.2, 0.2, 0.3],
          [0.1, 0.1, 0.05, 0.08],
        ],
      },
      { frame: 5, t: 0.2, boxes: [] },
    ]);
    expect(r.face_height).toBe(0.3);
    expect(r.verdict).toBe("unmeasured");
  });
});
