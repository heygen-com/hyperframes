import { describe, expect, it } from "vitest";
import { extractMediaSrcMutations } from "./mediaSrcMutation.js";

describe("extractMediaSrcMutations", () => {
  it.each([
    {
      label: "block",
      script: `const media = document.getElementById("video"); { const media = document.getElementById("image"); media.src = "image.png"; } media.src = "new.mp4";`,
    },
    {
      label: "sibling functions",
      script: `function updateImage() { const media = document.getElementById("image"); media.src = "image.png"; } function updateVideo() { const media = document.getElementById("video"); media.src = "new.mp4"; }`,
    },
    {
      label: "arrow function",
      script: `const media = document.getElementById("video"); const updateImage = () => { const media = document.getElementById("image"); media.src = "image.png"; }; media.src = "new.mp4";`,
    },
  ])("keeps $label bindings separate", ({ script }) => {
    expect(extractMediaSrcMutations(script).map((mutation) => mutation.selector)).toEqual([
      "#image",
      "#video",
    ]);
  });

  it.each([
    {
      label: "parameter",
      script: `const media = document.getElementById("video"); function update(media) { media.src = "image.png"; } media.src = "new.mp4";`,
    },
    {
      label: "destructured parameter",
      script: `const media = document.getElementById("video"); function update({ media }) { media.src = "image.png"; } media.src = "new.mp4";`,
    },
    {
      label: "unknown local",
      script: `const media = document.getElementById("video"); { const media = findImage(); media.src = "image.png"; } media.src = "new.mp4";`,
    },
    {
      label: "destructured local",
      script: `const media = document.getElementById("video"); { const { media } = assets; media.src = "image.png"; } media.src = "new.mp4";`,
    },
    {
      label: "catch parameter",
      script: `const media = document.getElementById("video"); try { update(); } catch(media) { media.src = "image.png"; } media.src = "new.mp4";`,
    },
    {
      label: "loop variable",
      script: `const media = document.getElementById("video"); for (const media of images) { media.src = "image.png"; } media.src = "new.mp4";`,
    },
  ])("does not inherit an outer target through a $label", ({ script }) => {
    expect(extractMediaSrcMutations(script)).toEqual([
      { selector: "#video", operation: "src_assignment", raw: `media.src = "new.mp4"` },
    ]);
  });

  it("resolves a closure and its scoped aliases", () => {
    const script = `const media = document.getElementById("video"); { const alias = media; function update() { alias.setAttribute("src", "new.mp4"); } }`;
    expect(extractMediaSrcMutations(script)).toEqual([
      {
        selector: "#video",
        operation: "set_attribute",
        raw: `alias.setAttribute("src", "new.mp4")`,
      },
    ]);
  });

  it("keeps var declarations in their enclosing function", () => {
    const script = `function update() { { var media = document.getElementById("video"); } media.src = "new.mp4"; }`;
    expect(extractMediaSrcMutations(script).map((mutation) => mutation.selector)).toEqual([
      "#video",
    ]);
  });

  it("retains a parameter that is redeclared and initialized with var", () => {
    const script = `function update(media) { var media = document.getElementById("video"); media.src = "new.mp4"; }`;
    expect(extractMediaSrcMutations(script).map((mutation) => mutation.selector)).toEqual([
      "#video",
    ]);
  });

  it("does not inherit an outer target through a named class expression", () => {
    const script = `const media = document.getElementById("video"); const View = class media { update() { media.src = "not-a-video"; } }; media.src = "new.mp4";`;
    expect(extractMediaSrcMutations(script).map((mutation) => mutation.selector)).toEqual([
      "#video",
    ]);
  });

  it("does not leak block declarations outside their scope", () => {
    const script = `{ const media = document.getElementById("video"); } media.src = "new.mp4";`;
    expect(extractMediaSrcMutations(script)).toEqual([]);
  });

  it("retains direct and computed DOM lookups", () => {
    const script = `document["getElementById"]("video")["src"] = "new.mp4"; document.querySelector("#audio").setAttribute("SRC", "new.wav");`;
    expect(extractMediaSrcMutations(script).map((mutation) => mutation.selector)).toEqual([
      "#video",
      "#audio",
    ]);
  });

  it("keeps module parsing and rejects malformed scripts", () => {
    expect(
      extractMediaSrcMutations(
        `export const media = document.getElementById("video"); media.src = "new.mp4";`,
      ),
    ).toHaveLength(1);
    expect(extractMediaSrcMutations("const media = ;")).toEqual([]);
  });

  it("does not recurse through circular aliases", () => {
    expect(extractMediaSrcMutations(`let a = b; let b = a; a.src = "new.mp4";`)).toEqual([]);
  });
});
