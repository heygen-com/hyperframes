// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createHappyDomRootHarness } from "./testRootHarness";
import { AudibleVideoClipContent } from "./AudibleVideoClipContent";

const harness = createHappyDomRootHarness();

describe("AudibleVideoClipContent", () => {
  it("draws the sound on the audio clip's own surface, under half the clip", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      harness
        .mount(host)
        .render(
          <AudibleVideoClipContent thumbnail={<span>frames</span>} waveform={<span>wave</span>} />,
        );
    });
    const strip = host.querySelector<HTMLElement>('[data-testid="audible-video-wave"]');
    expect(strip?.textContent).toBe("wave");
    expect(strip?.style.backgroundColor).toBe("var(--timeline-clip-audio-bg)");
    expect(strip?.style.height).toBe("50%");
    expect(strip?.previousElementSibling?.getAttribute("style")).toContain("bottom: 50%");
  });
});
