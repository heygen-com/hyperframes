// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { makeSelection } from "./domSelectionTestHarness";
import { useStudioSelectionPublisher } from "./useStudioSelectionPublisher";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetches = vi.hoisted(() => ({ bodies: [] as unknown[] }));
vi.mock("../utils/studioApiFetch", () => ({
  studioApiFetch: (_url: string, init: { body: string }) => {
    fetches.bodies.push(JSON.parse(init.body).selection);
    return Promise.resolve(new Response(null));
  },
}));

afterEach(() => {
  fetches.bodies.length = 0;
});

function publish(selection: DomEditSelection) {
  function Probe() {
    useStudioSelectionPublisher({
      projectId: "p",
      domEditSelection: selection,
      domEditSelectionRef: { current: selection },
      refreshKey: 0,
      previewDocumentVersion: 0,
      refreshDomEditSelectionFromPreview: () => Promise.resolve(),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return fetches.bodies[0];
}

it("tells agents about an opaque frame's selection, whose stand-in is never connected", () => {
  const selection = makeSelection("Title", document.createElement("h1"));
  expect(publish({ ...selection, handle: "0123456789abcdef:1" })).toMatchObject({
    schemaVersion: 1,
  });
});

it("still withholds a scriptable frame's selection once its element is gone", () => {
  expect(publish(makeSelection("Title", document.createElement("h1")))).toBeNull();
});
