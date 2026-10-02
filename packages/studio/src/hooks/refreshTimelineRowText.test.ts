// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import { refreshTimelineRowText } from "./refreshTimelineRowText";

afterEach(() => {
  usePlayerStore.getState().reset();
  document.body.innerHTML = "";
});

describe("refreshTimelineRowText", () => {
  it("gives the edited layer's row its new words", () => {
    document.body.innerHTML = `<h1 id="title">New words</h1>`;
    usePlayerStore.getState().setElements([
      {
        id: "title",
        tag: "h1",
        start: 0,
        duration: 2,
        track: 0,
        selector: "#title",
        text: { value: "Old" },
      },
    ]);

    refreshTimelineRowText(document.getElementById("title")!);

    expect(usePlayerStore.getState().elements[0]?.text?.value).toBe("New words");
  });
});
