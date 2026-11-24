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

describe("remove-elements", () => {
  it("removes every named clip, a composition host among them", () => {
    const { handle, present } = film();
    expect(removeElements({ handles: [handle("a"), handle("host")] })).toEqual({ removed: 2 });
    expect(present()).toEqual(["root", "b", "inner", "s"]);
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
