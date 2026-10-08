import gsap from "gsap";
import { afterEach, expect, it } from "vitest";
import { installGsapPercentTranslations } from "./gsapPercentTranslations";

const css = gsap.plugins.css;
const original = { get: css.get, getSetter: css.getSetter, init: css.prototype.init };
afterEach(() => {
  Object.assign(css, { get: original.get, getSetter: original.getSetter });
  css.prototype.init = original.init;
  document.body.innerHTML = "";
});

it("binds the adapter to the real GSAP CSS plugin and parsed transform cache", () => {
  expect(typeof css.get).toBe("function");
  expect(typeof css.getSetter).toBe("function");
  expect(typeof css.prototype.init).toBe("function");
  expect(css.aliases.transform.split(",")).toContain("yPercent");
  const target = document.createElement("div");
  target.style.transform = "matrix(1, 0, 0, 1, -170, -113.5)";
  document.body.append(target);
  gsap.getProperty(target, "x");
  const cache = gsap.core.getCache(target) as unknown as Record<string, unknown>;
  expect(typeof cache.x).toBe("string");
  expect(typeof cache.y).toBe("string");
  expect(typeof cache.xPercent).toBe("number");
  expect(typeof cache.yPercent).toBe("number");
  installGsapPercentTranslations(gsap);
  expect(css.get).not.toBe(original.get);
  expect(css.getSetter).not.toBe(original.getSetter);
  expect(css.prototype.init).not.toBe(original.init);
});
