import { describe, expect, it } from "vitest";
import { installPositionEditsSeekReapply } from "./positionEdits";

describe("init.ts per-seek position-edit parity", () => {
  it("recomputes the position edit after renderSeek", () => {
    document.body.innerHTML =
      '<h1 data-x="20" data-y="0" data-hf-edit-base-x="0" data-hf-edit-base-y="0">hi</h1>';
    const h1 = document.querySelector("h1");
    if (!(h1 instanceof HTMLElement)) throw new Error("test element missing");

    // @ts-expect-error test global
    window.__player = {
      renderSeek: () => h1.setAttribute("data-x", "40"),
    };
    installPositionEditsSeekReapply(window as Window & typeof globalThis);
    // @ts-expect-error test global
    window.__player.renderSeek(1);

    expect(h1.style.getPropertyValue("translate")).toBe("40px 0px");
    // @ts-expect-error test global
    delete window.__player;
    h1.remove();
  });
});
