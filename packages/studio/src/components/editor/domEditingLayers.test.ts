// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveDomEditSelection } from "./domEditingLayers";

const opts = { activeCompositionPath: "index.html", isMasterView: true, skipSourceProbe: true };

describe("resolveDomEditSelection — hfId from data-hf-id", () => {
  it("populates hfId from the element data-hf-id attribute", async () => {
    const el = document.createElement("div");
    el.id = "hero";
    el.setAttribute("data-hf-id", "hf-x7k2");
    document.body.appendChild(el);

    const selection = await resolveDomEditSelection(el, opts);
    document.body.removeChild(el);

    expect(selection?.hfId).toBe("hf-x7k2");
  });

  it("leaves hfId undefined when element has no data-hf-id", async () => {
    const el = document.createElement("div");
    el.id = "no-hfid-el";
    document.body.appendChild(el);

    const selection = await resolveDomEditSelection(el, opts);
    document.body.removeChild(el);

    expect(selection?.hfId).toBeUndefined();
  });
});
