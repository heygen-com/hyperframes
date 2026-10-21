import { describe, expect, it } from "vitest";
import { sharedHfMark } from "./scopedNodeMarks";

describe("sharedHfMark", () => {
  it("lets a claim on an indexed node of a scoped query stay the scene's own", () => {
    expect(
      sharedHfMark(
        "(function(){var a=document.querySelectorAll('[id=\"r\"]');for(var i=0;i<a.length;i++){if(!a[i].__hfClaimed){a[i].__hfClaimed=1;return a[i];}}})();",
      ),
    ).toBeNull();
  });

  it("shares a mark it cannot place on a scoped node: a string key, a list passed on, an unparsable script", () => {
    expect(
      sharedHfMark("const a = document.querySelectorAll('p'); a[0]['__hfReady'] = 1;")?.text,
    ).toBe("__hfReady");
    expect(
      sharedHfMark("const a = document.querySelectorAll('p'); keep(a); a[0].__hfReady = 1;")?.text,
    ).toBe("__hfReady");
    expect(
      sharedHfMark("const a = document.querySelectorAll('p'); a[0].__hfReady = ;")?.index,
    ).toBe(47);
  });

  it("shares a mark when `document` is the script's own binding, not the scene's scoped document", () => {
    const shadowed = [
      'const document = { querySelectorAll: () => [window] }; const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";',
      '((document) => { const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready"; })({ querySelectorAll: () => [window] });',
      'function document() {} const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";',
      'try {} catch (document) { const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready"; }',
      'document = { querySelectorAll: () => [window] }; const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";',
      'with ({ document: { querySelectorAll: () => [window] } }) { var a = document.querySelectorAll(".x"); a[0].__hfReady = "ready"; }',
    ];
    expect(shadowed.map((script) => sharedHfMark(script)?.text ?? null)).toEqual(
      shadowed.map(() => "__hfReady"),
    );
  });

  it("shares a mark once the script replaces an entry of the query's array, which is a plain mutable array", () => {
    const query = 'const a = document.querySelectorAll(".x");';
    const replaced = [
      `${query} a[0] = window; a[0].__hfReady = "ready";`,
      `${query} a[0] ??= window; a[0].__hfReady = "ready";`,
      `${query} [a[0]] = [window]; a[0].__hfReady = "ready";`,
      `${query} ({ first: a[0] } = { first: window }); a[0].__hfReady = "ready";`,
      `${query} for (a[0] of [window]) {} a[0].__hfReady = "ready";`,
      `${query} for (a[0] in { x: 1 }) {} a[0].__hfReady = "ready";`,
      `${query} delete a[0]; a[0].__hfReady = "ready";`,
    ];
    expect(replaced.map((script) => sharedHfMark(script)?.text ?? null)).toEqual(
      replaced.map(() => "__hfReady"),
    );
    expect(sharedHfMark(`${query} a[0].__hfClaimed = 1; a[0].style.color = "red";`)).toBeNull();
  });

  it("shares a mark unless every use of the list is a numeric index or its length, from a literal selector", () => {
    const query = 'const a = document.querySelectorAll(".x");';
    const unproven = [
      `${query} a["fill"](window); a[0].__hfReady = "ready";`,
      `${query} a["splice"](0, 1, window); a[0].__hfReady = "ready";`,
      `${query} const k = "fill"; a[k](window); a[0].__hfReady = "ready";`,
      `${query} const i = "fill"; a[i](window); a[0].__hfReady = "ready";`,
      `${query} a["fill"].__hfReady = "ready";`,
      `${query} a["0"].__hfReady = "ready";`,
      `${query} let i = 0; i = "fill"; a[i](window); a[0].__hfReady = "ready";`,
      'const a = document.querySelectorAll({ toString() { return "html"; } }); a[0].__hfReady = "ready";',
      'const s = ".x"; const a = document.querySelectorAll(s); a[0].__hfReady = "ready";',
      'const a = document.querySelectorAll(`${"html"}`); a[0].__hfReady = "ready";',
    ];
    expect(unproven.map((script) => sharedHfMark(script)?.text ?? null)).toEqual(
      unproven.map(() => "__hfReady"),
    );
    expect(
      sharedHfMark(`${query} for (let i = 0; i < a.length; i++) a[i].__hfClaimed = 1;`),
    ).toBeNull();
  });

  it("shares a mark when any write site, a for-of or for-in target included, rebinds `document`", () => {
    const fake = "{ querySelectorAll: () => [window] }";
    const rebound = [
      `for (document of [${fake}]) {} const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";`,
      `for (document in { x: 1 }) {} const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";`,
      `[document] = [${fake}]; const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";`,
      `({ d: document } = { d: ${fake} }); const a = document.querySelectorAll(".x"); a[0].__hfReady = "ready";`,
    ];
    expect(rebound.map((script) => sharedHfMark(script)?.text ?? null)).toEqual(
      rebound.map(() => "__hfReady"),
    );
  });

  it.each(["arguments[0] = window.document;", "[].fill.call(arguments, window.document);"])(
    "shares a mark when the wrapper's document can be rebound through %s",
    (rebind) => {
      expect(
        sharedHfMark(`${rebind} const a = document.querySelectorAll(".x"); a[0].__hfReady = 1;`)
          ?.text,
      ).toBe("__hfReady");
    },
  );

  it("shares a mark when the script can run code it does not show, through eval", () => {
    const query = 'const a = document.querySelectorAll(".x");';
    const hidden = [
      `${query} eval("a[0] = window"); a[0].__hfReady = "ready";`,
      `${query} eval?.("a[0] = window"); a[0].__hfReady = "ready";`,
      `${query} const run = eval; run("a[0] = window"); a[0].__hfReady = "ready";`,
    ];
    expect(hidden.map((script) => sharedHfMark(script)?.text ?? null)).toEqual(
      hidden.map(() => "__hfReady"),
    );
    expect(sharedHfMark(`${query} window.evaluate = 1; a[0].__hfClaimed = 1;`)).toBeNull();
  });
});
