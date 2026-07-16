// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { queryElementStacking } from "./videoFrameInjector.js";

class TestDOMMatrix {
  constructor(
    readonly a = 1,
    readonly d = 1,
    readonly e = 0,
    readonly f = 0,
  ) {}

  translate(x: number, y: number): TestDOMMatrix {
    return new TestDOMMatrix(this.a, this.d, this.e + x, this.f + y);
  }

  multiply(other: TestDOMMatrix): TestDOMMatrix {
    return new TestDOMMatrix(this.a * other.a, this.d * other.d, this.e, this.f);
  }

  rotate(): TestDOMMatrix {
    return this;
  }

  scale(x: number, y: number): TestDOMMatrix {
    return new TestDOMMatrix(this.a * x, this.d * y, this.e, this.f);
  }

  toString(): string {
    return `matrix(${this.a}, 0, 0, ${this.d}, ${this.e}, ${this.f})`;
  }
}

describe("queryElementStacking individual transforms", () => {
  beforeEach(() => {
    Object.assign(globalThis, { DOMMatrix: TestDOMMatrix });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "DOMMatrix");
  });

  it("preserves an individual scale of zero", async () => {
    const element = document.createElement("div");
    element.id = "collapsed";
    element.dataset.start = "0";
    element.style.scale = "0";
    document.body.appendChild(element);
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((node) => {
      const style = getComputedStyle(node);
      if (node !== element) return style;
      return new Proxy(style, {
        get(target, property) {
          if (property === "getPropertyValue") {
            return (name: string) => (name === "scale" ? "0" : target.getPropertyValue(name));
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });

    const page = {
      evaluate: async <T, A>(callback: (arg: A) => T, arg: A) => callback(arg),
    } as unknown as Page;

    const [result] = await queryElementStacking(page, new Set(["collapsed"]));

    expect(result?.transform).toBe("matrix(0, 0, 0, 0, 0, 0)");
  });
});
