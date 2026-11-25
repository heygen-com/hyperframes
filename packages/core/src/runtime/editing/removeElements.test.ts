import { afterEach, describe, expect, it } from "vitest";
import { handleFor } from "../editingHandles";
import { removeElements } from "./removeElements";

afterEach(() => {
  document.body.innerHTML = "";
});

function film() {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-start="0" data-duration="8">
      <div id="a" class="clip" data-start="0" data-duration="4"></div>
      <div id="b" class="clip" data-start="4" data-duration="4"><span id="inner">B</span></div>
      <div id="host" data-composition-id="intro" data-composition-src="intro.html"></div>
      <script id="s">/* film script */</script>
    </div>`;
  const handle = (id: string) => handleFor(document.getElementById(id)!);
  const present = () =>
    ["root", "a", "b", "inner", "host", "s"].filter((id) => document.getElementById(id));
  return { handle, present };
}

function kinds() {
  document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-start="0" data-duration="8">
        <img id="pic" src="a.png" />
        <video id="vid" src="a.mp4"></video>
        <audio id="aud" src="a.mp3"></audio>
        <div id="lane" data-track-index="2"></div>
        <div id="timed" data-start="1"></div>
      </div>`;
}

describe("remove-elements", () => {
  it("removes every named clip, a composition host among them", () => {
    const { handle, present } = film();
    expect(removeElements({ handles: [handle("a"), handle("host")] })).toEqual({ removed: 2 });
    expect(present()).toEqual(["root", "b", "inner", "s"]);
  });

  it.each([
    ["an image", "pic"],
    ["a video without data-start", "vid"],
    ["an audio without data-start", "aud"],
    ["a clip placed only by data-track-index", "lane"],
  ])("removes %s, which the runtime's timeline lists as a clip", (_, id) => {
    kinds();
    expect(removeElements({ handles: [handleFor(document.getElementById(id)!)] })).toEqual({
      removed: 1,
    });
    expect(document.getElementById(id)).toBeNull();
  });

  it.each([
    ["the clip first", ["p", "c", "p"]],
    ["its child first", ["c", "p"]],
  ])(
    "counts each clip once, though a batch names it twice or names its child too (%s)",
    (_, ids) => {
      document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-start="0" data-duration="8">
        <div id="p" data-start="0"><div id="c" data-start="1"></div></div>
      </div>`;
      const handles = ids.map((id) => handleFor(document.getElementById(id)!));
      expect(removeElements({ handles })).toEqual({ removed: 1 });
      expect(document.getElementById("p")).toBeNull();
    },
  );

  it("removes every kind of clip the runtime's timeline lists, all of them in one mixed delete", () => {
    kinds();
    const ids = ["pic", "vid", "aud", "lane", "timed"];
    const handles = ids.map((id) => handleFor(document.getElementById(id)!));
    expect(removeElements({ handles })).toEqual({ removed: 5 });
    expect(ids.filter((id) => document.getElementById(id))).toEqual([]);
    expect(document.getElementById("root")).not.toBeNull();
  });

  it.each([
    ["the root composition", "root"],
    ["an element that is not a clip", "inner"],
    ["a script", "s"],
  ])("removes nothing when one handle names %s", (_, id) => {
    const { handle, present } = film();
    expect(removeElements({ handles: [handle("a"), handle(id)] })).toEqual({ removed: 0 });
    expect(present()).toEqual(["root", "a", "b", "inner", "host", "s"]);
  });

  it("removes nothing for the page's own elements or a handle of an element already gone", () => {
    const { handle, present } = film();
    const gone = handle("b");
    document.getElementById("b")!.remove();
    expect(removeElements({ handles: [handle("a"), gone] })).toEqual({ removed: 0 });
    expect(removeElements({ handles: [handleFor(document.body)] })).toEqual({ removed: 0 });
    expect(removeElements({ handles: [handleFor(document.documentElement)] })).toEqual({
      removed: 0,
    });
    expect(present()).toEqual(["root", "a", "host", "s"]);
  });
});
