import { describe, expect, it } from "vitest";
import { extendRootDurationInSource } from "./rootDuration";

describe("extendRootDurationInSource", () => {
  it("extends data-duration when the new end is bigger than the root duration", () => {
    const source = [
      `<div data-composition-id="main" data-duration="4">`,
      `  <section id="clip" data-start="2" data-duration="3"></section>`,
      `</div>`,
    ].join("\n");

    expect(extendRootDurationInSource(source, 5.25)).toContain(
      `data-composition-id="main" data-duration="5.25"`,
    );
  });

  it("does nothing when the new end is smaller than or equal to the root duration", () => {
    const source = `<div data-composition-id="main" data-duration="6"></div>`;

    expect(extendRootDurationInSource(source, 5)).toBe(source);
    expect(extendRootDurationInSource(source, 6)).toBe(source);
  });

  it("leaves non-root data-duration attributes untouched by the extension", () => {
    const source = [
      `<div data-duration="3"></div>`,
      `<div data-composition-id="main" data-duration="4"></div>`,
    ].join("\n");
    const patched = extendRootDurationInSource(source, 7);

    expect(patched).toContain(`<div data-duration="3"></div>`);
    expect(patched).toContain(`<div data-composition-id="main" data-duration="7"></div>`);
  });
});
