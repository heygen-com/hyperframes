// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMotionBlurProbe } from "./checkMotionBlur.js";

const report = {
  state: "off",
  tier: "filter",
  reason: "why",
  reasonCode: "root-transform",
  movers: 3,
};

function page(html: string, withApi = true, order: string[] = []) {
  document.body.innerHTML = html;
  const probe = vi.fn(() => {
    order.push("probe");
    return report;
  });
  const suspend = vi.fn(() => order.push("suspend"));
  if (withApi) Reflect.set(window, "__hfMotionBlur", { probe, suspend });
  return Object.assign(probe, { suspend });
}

afterEach(() => {
  Reflect.deleteProperty(window, "__hfMotionBlur");
  document.body.innerHTML = "";
});

const MAIN = '<div data-composition-id="main" data-motion-blur="on"></div>';
const TWO_COMPOSITIONS =
  '<div data-composition-id="empty"></div>' +
  '<div data-composition-id="main" data-root="true" data-motion-blur="on"></div>';

describe("readMotionBlurProbe", () => {
  it("calls the runtime probe and returns its report", () => {
    const probe = page(MAIN);
    expect(readMotionBlurProbe()).toEqual(report);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("asks the runtime, not the first composition's attribute, which root wants blur", () => {
    const probe = page(TWO_COMPOSITIONS);
    expect(readMotionBlurProbe()).toEqual(report);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("suspends blur painting right after the probe, so the audits read plain DOM", () => {
    const order: string[] = [];
    page(MAIN, true, order);
    readMotionBlurProbe();
    expect(order).toEqual(["probe", "suspend"]);
  });

  it("still reads the probe from a runtime that has no suspend", () => {
    document.body.innerHTML = MAIN;
    Reflect.set(window, "__hfMotionBlur", { probe: () => report });
    expect(readMotionBlurProbe()).toEqual(report);
  });

  it("takes the mover count from the report, and reads a missing one as none", () => {
    Reflect.set(window, "__hfMotionBlur", { probe: () => ({ state: "on", movers: 7 }) });
    expect(readMotionBlurProbe()).toMatchObject({ movers: 7 });
    Reflect.set(window, "__hfMotionBlur", { probe: () => ({ state: "on" }) });
    expect(readMotionBlurProbe()).toMatchObject({ state: "on", movers: 0, reason: null });
  });

  it("reads nothing when the runtime installed no instance, as for a composition that never opted in", () => {
    page('<div data-composition-id="main"></div>', false);
    expect(readMotionBlurProbe()).toBeNull();
  });
});
