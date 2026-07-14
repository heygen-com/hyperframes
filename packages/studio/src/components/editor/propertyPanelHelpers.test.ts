import { describe, expect, it } from "vitest";
import { selectionIdentityKey } from "./propertyPanelHelpers";

describe("selectionIdentityKey", () => {
  it("keeps otherwise matching elements in different source files distinct", () => {
    const sharedIdentity = {
      id: null,
      hfId: "hero-title",
      selector: ".title",
      selectorIndex: 0,
    };
    const intro = { ...sharedIdentity, sourceFile: "scenes/intro.html" };
    const outro = { ...sharedIdentity, sourceFile: "scenes/outro.html" };
    expect(selectionIdentityKey(intro)).not.toBe(selectionIdentityKey(outro));
  });
});
