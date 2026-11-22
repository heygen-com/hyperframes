// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { mintElementHandle } from "../../webmcp/handles";
import { measureTopologyLensGeometry } from "./topologyLensGeometry";

const FIXTURE = `
  <main id="root" data-composition-id="root" data-composition-file="index.html" data-width="1920" data-height="1080">
    <section id="host" data-composition-id="nested" data-composition-file="compositions/nested.html">
      <article id="context">
        <div id="duplicate"><strong id="child">nested</strong></div>
        <aside id="aside">outside target</aside>
      </article>
    </section>
  </main>`;
const RECTS: Record<string, number[]> = {
  root: [0, 0, 1920, 1080],
  host: [100, 100, 1200, 800],
  context: [150, 150, 1000, 600],
  duplicate: [200, 200, 400, 200],
  child: [220, 220, 200, 60],
  aside: [700, 200, 300, 200],
};
const FRAME = [100, 50, 960, 540];

function sized<T extends Element>(element: T, [x, y, width, height]: number[]): T {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  return element;
}

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
  for (const [id, rect] of Object.entries(RECTS)) sized(document.getElementById(id)!, rect);
});
afterEach(() => {
  document.body.innerHTML = "";
});

function liveFrame(): HTMLIFrameElement {
  const iframe = detachedFakeIframe(window as unknown as Record<string, unknown>);
  Object.defineProperty(iframe, "contentDocument", { value: document });
  return sized(iframe, FRAME);
}

function sealedFrame(): HTMLIFrameElement {
  const { iframe: sealed, frame } = sealedPreviewFrame();
  const iframe = sized(sealed, FRAME);
  watchPreviewFrame(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );
  return iframe;
}

const labels = (geometry: Awaited<ReturnType<typeof measureTopologyLensGeometry>>) =>
  geometry && {
    field: geometry.field.label,
    target: geometry.target.label,
    contours: geometry.contours.map((contour) => contour.label),
  };

it("draws the same lens in a sealed frame as in a live one", async () => {
  const handle = mintElementHandle({
    domId: "duplicate",
    sourceFile: "compositions/nested.html",
    activeCompositionPath: "index.html",
  })!;
  const measure = (iframe: HTMLIFrameElement) =>
    measureTopologyLensGeometry({
      overlay: sized(document.createElement("div"), [0, 0, 1200, 800]),
      iframe,
      activeCompositionPath: "index.html",
      handle,
    });

  const live = labels(await measure(liveFrame()));
  const sealed = labels(await measure(sealedFrame()));

  expect(live).toEqual({ field: "section", target: "div", contours: ["strong", "aside"] });
  expect(sealed).toEqual(live);
});
