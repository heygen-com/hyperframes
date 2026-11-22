import { afterEach, describe, expect, it, vi } from "vitest";
import { printDoctorOutcomes } from "./doctor.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("doctor output", () => {
  // fails without the fix: a check's name, detail and hint are printed as the check returned them.
  it("shows control characters in a check row as text", () => {
    const said: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      said.push(args.join(" "));
    });
    printDoctorOutcomes([
      {
        name: `Tool ${ODD}`,
        ok: false,
        detail: `not found at ${ODD}\nsecond line`,
        hint: `install ${ODD}`,
      },
    ]);
    const text = said.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
    expect(text).toContain(`Tool ${SHOWN}`);
    expect(text).toContain(`not found at ${SHOWN}\nsecond line`);
    expect(text).toContain(`install ${SHOWN}`);
    expect(text).not.toContain(ESC);
    expect(text).not.toContain("\x07");
  });
});
