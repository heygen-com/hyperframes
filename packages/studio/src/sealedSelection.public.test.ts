// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { sealedPreviewFrame } from "./player/lib/sealedPreviewFrame.test-helpers";
import {
  describePreviewElements,
  editSealedSelection,
  queryPreviewElements,
  resolveFoundSelection,
} from "./index";

const FIXTURE = `
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <h1 id="target" style="opacity: 0.8">Ship it</h1>
  </div>`;
const CONTEXT = { activeCompositionPath: "index.html", isMasterView: false };

afterEach(() => {
  document.body.innerHTML = "";
});

// An app embedding Studio styles a sealed pick the way Studio's own panel does: one selection, one preview owner.
it("an app embedding Studio previews a style on a sealed pick and puts it back, through the public API", async () => {
  document.body.innerHTML = FIXTURE;
  const { iframe } = sealedPreviewFrame();
  const [match] = (await queryPreviewElements(iframe, "#target"))!.matches;
  const [described] = (await describePreviewElements(iframe, [match!.handle]))!;

  const selection = await resolveFoundSelection(iframe, described!, CONTEXT);
  expect(selection?.handle).toBe(match!.handle);
  expect(selection?.computedStyles.opacity).toBe("0.8");

  const target = document.getElementById("target")!;
  const edit = editSealedSelection(iframe, selection!, { styles: [["opacity", "0.3"]] })!;
  expect(await edit.drawn).toBe(true);
  expect(target.style.opacity).toBe("0.3");
  edit.restore();
  await vi.waitFor(() => expect(target.style.opacity).toBe("0.8"));
});
