// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { TimelineElement } from "../player/store/playerStore";
import { removeIframeTimelineElements } from "./previewTimingPatch";

afterEach(() => {
  document.body.innerHTML = "";
});

function preview(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="8">
      <div id="a" class="clip" data-start="0" data-duration="4"></div>
      <div id="host" data-composition-id="intro" data-composition-src="intro.html" data-composition-file="intro.html"></div>
    </div></body></html>`);
  doc.close();
  return iframe;
}

const present = (iframe: HTMLIFrameElement) =>
  ["root", "a", "host"].filter((id) => iframe.contentDocument!.getElementById(id));

it("a timeline delete never removes the root composition, even for a clip it cannot find", () => {
  const iframe = preview();
  const unfound = { id: "outro", kind: "composition", compositionSrc: "outro.html" };
  const bare = { id: "main", kind: "composition", compositionSrc: "missing.html" };
  removeIframeTimelineElements(
    iframe,
    [unfound, bare] as unknown as TimelineElement[],
    "index.html",
  );
  expect(present(iframe)).toEqual(["root", "a", "host"]);

  const host = { id: "intro", kind: "composition", compositionSrc: "intro.html" };
  removeIframeTimelineElements(iframe, [host] as unknown as TimelineElement[], "index.html");
  expect(present(iframe)).toEqual(["root", "a"]);
});
