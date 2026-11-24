import { expect, it } from "vitest";
import * as studio from "@hyperframes/studio";
import * as elements from "./player/lib/previewElements";
import * as selection from "./components/editor/previewSelection";

it("exports a sealed preview's checked element reads and stand-ins as the ones Studio uses", () => {
  expect(studio.describePreviewElements).toBe(elements.describePreviewElements);
  expect(studio.previewAncestors).toBe(elements.previewAncestors);
  expect(studio.previewElementsAtPoint).toBe(elements.previewElementsAtPoint);
  expect(studio.previewGeometry).toBe(elements.previewGeometry);
  expect(studio.previewLayers).toBe(elements.previewLayers);
  expect(studio.previewPointerTargets).toBe(elements.previewPointerTargets);
  expect(studio.queryPreviewElements).toBe(elements.queryPreviewElements);
  expect(studio.findPreviewElementForSelection).toBe(selection.findPreviewElementForSelection);
  expect(studio.findPreviewElementForTimelineElement).toBe(
    selection.findPreviewElementForTimelineElement,
  );
  expect(studio.readable).toBe(selection.readable);
  expect(studio.standInFor).toBe(selection.standInFor);
  expect(studio.standInHandle).toBe(selection.standInHandle);
});
