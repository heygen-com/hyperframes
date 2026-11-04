import { describe, expect, it } from "vitest";
import { selfClosedMediaWarning } from "./snapshot.js";

const page = (media: string) => `<!doctype html><html><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1280" data-height="720">
${media}
<h1 id="title">Hello</h1></div></body></html>`;

describe("selfClosedMediaWarning", () => {
  it("names the self-closed clips and what they do to the still", async () => {
    const clips = Array.from(
      { length: 3 },
      (_, i) => `<audio id="sfx${i}" src="s${i}.wav" data-start="${i}" data-duration="1" />`,
    ).join("\n");

    const warning = await selfClosedMediaWarning(page(clips));

    expect(warning).toContain("3 self-closed <audio>/<video> tags");
    expect(warning).toContain("#sfx0");
    expect(warning).toContain("stills come out blank");
  });

  it("stays quiet when every clip has a closing tag, even with fallback content", async () => {
    const closed = `<audio id="a" src="a.wav" data-start="0" data-duration="1"></audio>
<video id="v" src="v.mp4" data-start="0" data-duration="2"><p>Your browser cannot play this.</p></video>`;

    expect(await selfClosedMediaWarning(page(closed))).toBeNull();
  });
});
