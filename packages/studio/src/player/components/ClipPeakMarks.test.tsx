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
  it("uses a plain warning and keeps the numeric peak in the hover detail", async () => {
    const host = await render("/api/projects/p/peaks/loud.mp4", [0.2, 0.98], 1);
    expect(host.textContent).toContain("wave");
    expect(host.querySelector("[data-testid=clip-peak-marks]")?.textContent).toContain(
      "▲ Too loud",
    );
    expect(host.querySelector("[data-peak-text]")?.textContent).not.toContain("dBFS");
    expect(host.querySelector("[data-peak-badge]")?.getAttribute("title")).toBe(
      "Peaks −0.2 dBFS at this volume; export lowers the whole mix",
    );
  });

  it("paints nothing on a quiet clip", async () => {
    const host = await render("/api/projects/p/peaks/quiet.mp4", [0.25, 0.25], 1);
    expect(host.querySelector("[data-testid=clip-peak-marks]")).toBeNull();
  });
});
