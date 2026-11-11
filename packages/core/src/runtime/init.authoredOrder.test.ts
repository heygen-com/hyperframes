import gsap from "gsap";
import { expect, it } from "vitest";
import { installFlatGsapTransforms } from "./init";

// Its own file: the stamp patches GSAP's Timeline once for the whole process.
it("numbers the order a film writes its tweens in when GSAP loads after the runtime", () => {
  installFlatGsapTransforms();
  window.gsap = gsap as unknown as typeof window.gsap;
  const timeline = gsap.timeline({ paused: true });
  timeline.set({ a: 0 }, { a: 1 }).to({ b: 0 }, { b: 1, duration: 1 });
  const [first, second] = timeline.getChildren(false, true, true) as unknown as {
    _hfAuthored?: number;
  }[];
  expect(first?._hfAuthored).toBeDefined();
  expect(second?._hfAuthored).toBeGreaterThan(first?._hfAuthored ?? Infinity);
});
