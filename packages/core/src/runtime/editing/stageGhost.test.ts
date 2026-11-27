import { describe, expect, it } from "vitest";
import { inertStageGhost } from "./stageGhost";

describe("inertStageGhost", () => {
  it.each([
    ["script", `<div><script>bad()</script></div>`, "script"],
    ["svg script", `<div><svg><script>bad()</script></svg></div>`, "script"],
    ["iframe", `<div><iframe src="x"></iframe></div>`, "iframe"],
    ["object", `<div><object data="x"></object></div>`, "object"],
    ["embed", `<div><embed src="x"></div>`, "embed"],
    ["base", `<div><base href="https://x/"></div>`, "base"],
    ["meta refresh", `<div><meta http-equiv="refresh" content="0;url=https://x"></div>`, "meta"],
    ["link import", `<div><link rel="import" href="x.html"></div>`, "link"],
  ])("strips %s", (_, markup, selector) => {
    const ghost = inertStageGhost(document, markup);
    expect(ghost).not.toBeNull();
    expect(ghost!.querySelector(selector)).toBeNull();
  });

  it.each([
    ["an on* handler", `<div><img src="a.png" onerror="bad()"></div>`, "onerror"],
    ["an uppercase handler", `<div><img src="a.png" ONLOAD="bad()"></div>`, "onload"],
    ["srcdoc", `<div><span srcdoc="<script>bad()</script>"></span></div>`, "srcdoc"],
    ["a javascript: link", `<div><a href="javascript:bad()">x</a></div>`, "href"],
    [
      "a javascript: link split by whitespace",
      `<div><a href="java&#10;script:bad()">x</a></div>`,
      "href",
    ],
    [
      "an svg javascript: link",
      `<div><svg><a xlink:href="javascript:bad()"><text>x</text></a></svg></div>`,
      "xlink:href",
    ],
    [
      "an animated javascript: value",
      `<div><svg><a><set attributeName="href" to="javascript:bad()"/></a></svg></div>`,
      "to",
    ],
    [
      "a data:text/html URL",
      `<div><a href="data:text/html,<script>bad()</script>">x</a></div>`,
      "href",
    ],
  ])("strips %s", (_, markup, attribute) => {
    const ghost = inertStageGhost(document, markup)!;
    for (const element of [ghost, ...ghost.querySelectorAll("*")])
      expect(element.hasAttribute(attribute)).toBe(false);
  });

  it("keeps pictures and plain attributes, and refuses markup that is not one element or is itself stripped", () => {
    expect(
      inertStageGhost(document, `<div class="c"><img src="a.png" alt="A"></div>`)?.outerHTML,
    ).toBe(`<div class="c"><img src="a.png" alt="A"></div>`);
    expect(inertStageGhost(document, `<div></div><div></div>`)).toBeNull();
    expect(inertStageGhost(document, `<script>bad()</script>`)).toBeNull();
    expect(inertStageGhost(document, `just text`)).toBeNull();
    // The parser drops a frame inside a body; markup that is a frameset makes the frame the root itself.
    expect(inertStageGhost(document, `<frameset><frame src="x"></frameset>`)).toBeNull();
  });
});
