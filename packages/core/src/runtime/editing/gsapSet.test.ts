import { gsap as realGsap } from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawDrafts } from "../editingDraft";
import { handleFor } from "../editingHandles";
import { gsapSet, parseGsapSet } from "./gsapSet";

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
});

function box() {
  document.body.innerHTML = `<div id="box"></div>`;
  return document.getElementById("box")!;
}

describe("gsap-set", () => {
  it("sets the dragged values on the element in the frame", () => {
    const set = vi.fn();
    Object.assign(window, { gsap: { set } });
    const el = box();

    expect(gsapSet({ handle: handleFor(el), props: { rotationY: 30, z: -40 } })).toEqual({
      applied: true,
    });
    expect(set).toHaveBeenCalledExactlyOnceWith(el, { rotationY: 30, z: -40 });
  });

  it("does nothing when the frame has no GSAP or the element is gone", () => {
    const el = box();
    const handle = handleFor(el);
    expect(gsapSet({ handle, props: { x: 1 } })).toEqual({ applied: false });

    Object.assign(window, { gsap: { set: vi.fn() } });
    el.remove();
    expect(gsapSet({ handle, props: { x: 1 } })).toEqual({ applied: false });
  });

  it("takes only finite values on the transform channels Studio previews", () => {
    const handle = handleFor(box());
    expect(parseGsapSet({ handle, props: { x: 4, opacity: 0.5 } })).toEqual({
      handle,
      props: { x: 4, opacity: 0.5 },
    });
    for (const props of [{}, { x: Number.NaN }, { x: "4" }, { onComplete: 1 }, [1]])
      expect(parseGsapSet({ handle, props })).toBeNull();
    expect(parseGsapSet({ handle: "#box", props: { x: 1 } })).toBeNull();
    expect(parseGsapSet({ handle, props: { x: 1 }, extra: true })).toBeNull();
  });

  // fails without the fix: the draft's end put the layer's CSS translate back under the x/y committed from it, so a
  // sealed resize handed to GSAP drew 50 px off (translate 40px 30px) where an open preview leaves translate none.
  it.each(["keep-size", "restore"] as const)(
    "leaves the CSS translate GSAP's committed x/y now carry cleared when the draft ends (%s)",
    (end) => {
      Object.assign(window, { gsap: realGsap });
      const el = box();
      el.style.translate = "40px 30px";
      const handle = handleFor(el);
      drawDrafts([{ handle, translate: { x: -10, y: -4, route: "gsap" }, size: null }]);

      gsapSet({ handle, props: { x: -10.073, y: -3.715 } });
      drawDrafts([{ handle, end }]);

      expect(el.style.translate).toBe("none");
    },
  );
});
