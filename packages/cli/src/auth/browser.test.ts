import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBrowser } from "./browser.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const openState = vi.hoisted(() => ({ fail: "" }));
vi.mock("open", () => ({
  default: async () => {
    if (openState.fail) throw new Error(openState.fail);
  },
}));

describe("openBrowser when the page has to be opened by hand", () => {
  const lines: string[] = [];
  const printed = (): string => lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

  beforeEach(() => {
    lines.length = 0;
    openState.fail = "";
    vi.stubEnv("HF_BROWSER_LOG", "");
    vi.stubEnv("BROWSER", "");
    vi.stubEnv("HF_NO_BROWSER", "");
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // fails without the fix: the address is printed as it arrived.
  it("shows control characters in the address as text when auto-open is off", async () => {
    vi.stubEnv("HF_NO_BROWSER", "1");
    expect(await openBrowser(`https://example.com/${ODD}`)).toEqual({ opened: false });
    expect(printed()).toContain(`https://example.com/${SHOWN}`);
    expect(printed()).not.toContain(ESC);
    expect(printed()).not.toContain("\x07");
  });

  // fails without the fix: the reason and the address are printed as they arrived.
  it("shows control characters in the reason and address as text when opening fails", async () => {
    openState.fail = `no display ${ODD}`;
    expect(await openBrowser(`https://example.com/${ODD}`)).toEqual({ opened: false });
    expect(printed()).toContain(`(no display ${SHOWN}).`);
    expect(printed()).toContain(`https://example.com/${SHOWN}`);
    expect(printed()).not.toContain(ESC);
    expect(printed()).not.toContain("\x07");
  });
});
