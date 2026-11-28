// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { createHappyDomRootHarness } from "./testRootHarness";
import { clipPicture, TimelineTransitionBadge } from "./TimelineTransitionBadge";
import { usePlayerStore } from "../store/playerStore";

const harness = createHappyDomRootHarness();
afterEach(() => usePlayerStore.setState({ timelineProjectId: null }));

function imagesFor(outgoingSrc: string, incomingSrc: string): string[] {
  usePlayerStore.setState({ timelineProjectId: "p1" });
  const container = document.body.appendChild(document.createElement("div"));
  const root = harness.mount(container);
  act(() =>
    root.render(
      <TimelineTransitionBadge
        centerPx={10}
        top={4}
        widthPx={24}
        outgoingSrc={outgoingSrc}
        incomingSrc={incomingSrc}
      />,
    ),
  );
  return [...container.querySelectorAll<HTMLElement>(".timeline-transition__image")].map(
    (image) => image.style.backgroundImage,
  );
}

// fails without the fix: a clip src closing its url() added a second layer that loaded another address.
it("quotes a clip's media src whole inside one url()", () => {
  const src = 'https://cdn.invalid/a.png"), url("https://probe.invalid/beacon';
  expect(clipPicture(src, "p1", "http://studio.test")).toEqual({
    backgroundImage: `url(${JSON.stringify(src)})`,
  });
});

it("draws a project file from the project's preview route", () => {
  const [, inc] = imagesFor("", "media/b c.png");
  expect(inc).toBe('url("/api/projects/p1/preview/media/b%20c.png")');
});

it("draws nothing for a clip src naming another API route on Studio's origin, or climbing out", () => {
  const [out, inc] = imagesFor(`${location.origin}/api/projects/p1/render`, "../../secret.png");
  expect(out).toBe("");
  expect(inc).toBe("");
});
