// @vitest-environment jsdom
import { expect, it } from "vitest";
import { shownPreviewFrame } from "../../index";
import { announcePreviewPromoted } from "../sceneSwap";

it("a host's shown frame is the promoted one from the moment the promotion is announced, through the package index", () => {
  const host = document.body.appendChild(document.createElement("iframe"));
  const live = document.body.appendChild(document.createElement("iframe"));
  expect(shownPreviewFrame(host), "before any promotion").toBe(host);
  let atEvent: HTMLIFrameElement | null = null;
  document.addEventListener("hf-preview-promoted", () => (atEvent = shownPreviewFrame(host)), {
    once: true,
  });
  announcePreviewPromoted({ retired: host, live });
  expect(shownPreviewFrame(host), "in the same tick").toBe(live);
  expect(atEvent, "already when the promotion event fires").toBe(live);
});
