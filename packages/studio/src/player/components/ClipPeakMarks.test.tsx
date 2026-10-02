// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createHappyDomRootHarness } from "./testRootHarness";
import { ClipPeakMarks } from "./ClipPeakMarks";

const harness = createHappyDomRootHarness();

async function render(url: string, bins: number[], gain: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ binSeconds: 1, bins })),
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    harness.mount(host).render(
      <ClipPeakMarks peaksUrl={url} sourceWindow={{ mediaStart: 0, sourceSpan: 2 }} gain={gain}>
        <span>wave</span>
      </ClipPeakMarks>,
    );
  });
  await act(async () => {});
  vi.unstubAllGlobals();
  return host;
}

describe("ClipPeakMarks", () => {
  it("paints red marks and the peak on a clip that redlines", async () => {
    const host = await render("/api/projects/p/peaks/loud.mp4", [0.2, 0.98], 1);
    expect(host.textContent).toContain("wave");
    expect(host.querySelector("[data-testid=clip-peak-marks]")?.textContent).toContain(
      "▲ peaks −0.2 dBFS",
    );
  });

  it("paints nothing on a quiet clip", async () => {
    const host = await render("/api/projects/p/peaks/quiet.mp4", [0.25, 0.25], 1);
    expect(host.querySelector("[data-testid=clip-peak-marks]")).toBeNull();
  });
});
