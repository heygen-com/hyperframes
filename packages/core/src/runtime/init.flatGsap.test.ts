import gsap from "gsap";
import { expect, it, vi } from "vitest";
import { installFlatGsapTransforms } from "./init";

// Its own file: a non-configurable window.gsap cannot be removed again.
it("configures a GSAP held by a non-configurable window.gsap without throwing", () => {
  Object.defineProperty(window, "gsap", { value: gsap, writable: true, configurable: false });
  const config = vi.spyOn(gsap, "config");
  expect(() => installFlatGsapTransforms()).not.toThrow();
  expect(config).toHaveBeenCalledWith({ force3D: false });
  expect(window.gsap).toBe(gsap);
});
