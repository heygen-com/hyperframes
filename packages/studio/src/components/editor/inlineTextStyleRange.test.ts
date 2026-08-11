// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyInlineStyle } from "./inlineTextStyleRange";
import { readInlineStyle, readInlineStyleSpread } from "./inlineTextStyleRead";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<h1>${html}</h1>`;
  return document.body.firstElementChild as HTMLElement;
}

/** A range over the host's text, by character offsets across the whole element. */
/** Every text node and line break in order, with the offset each one starts at. */
function charSpans(host: HTMLElement): Array<{ node: Node; from: number; length: number }> {
  const spans: Array<{ node: Node; from: number; length: number }> = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const isBreak = node.nodeType === 1 && (node as Element).tagName === "BR";
    if (node.nodeType === 1 && !isBreak) continue;
    const length = isBreak ? 1 : (node.textContent?.length ?? 0);
    spans.push({ node, from: seen, length });
    seen += length;
  }
  return spans;
}

/**
 * A range over the host's text, by character offsets across the whole element.
 *
 * A line break counts as one character, the same way the module does, but is
 * never landed on: a boundary there belongs to the text beside it, which is
 * where a real selection would put it too.
 */
function rangeOver(host: HTMLElement, start: number, end: number): Range {
  const range = document.createRange();
  const text = charSpans(host).filter((span) => span.node.nodeType === 3);
  const at = (offset: number) => text.find((span) => span.from + span.length >= offset);
  const from = at(start);
  const to = at(end);
  if (from) range.setStart(from.node, start - from.from);
  if (from && to) range.setEnd(to.node, end - to.from);
  return range;
}

/** Elements left holding half a character by a boundary that fell inside one. */
function elementsWithHalfACharacter(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("*"))
    .map((node) => node.textContent ?? "")
    .filter((text) => {
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code >= 0xdc00 && code <= 0xdfff) return true;
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = text.charCodeAt(index + 1);
          if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
          index += 1;
        }
      }
      return false;
    });
}

describe("applyInlineStyle", () => {
  it("styles exactly the characters selected, and nothing else", () => {
    const host = mount("hello world");

    applyInlineStyle(rangeOver(host, 6, 11), { color: "red" });

    expect(host.innerHTML).toBe('hello <span style="color: red">world</span>');
  });

  it("styles a run in the middle, leaving the text either side alone", () => {
    const host = mount("abcdef");

    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.innerHTML).toBe('ab<span style="color: red">cd</span>ef');
    expect(host.textContent).toBe("abcdef");
  });

  it("does nothing at all when nothing is selected", () => {
    const host = mount("abc");
    const range = rangeOver(host, 1, 1);

    applyInlineStyle(range, { color: "red" });

    expect(host.innerHTML).toBe("abc");
  });

  // Left alone, every recolour would wrap the last one and the markup would
  // grow without bound while only the innermost span had any effect.
  it("replaces a colour rather than nesting a second span inside the first", () => {
    const host = mount("abc");

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });
    applyInlineStyle(rangeOver(host, 0, 3), { color: "blue" });

    expect(host.innerHTML).toBe('<span style="color: blue">abc</span>');
  });

  it("merges with the run beside it when the styling matches", () => {
    const host = mount("abcd");

    applyInlineStyle(rangeOver(host, 0, 2), { color: "red" });
    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.innerHTML).toBe('<span style="color: red">abcd</span>');
  });

  it("does not merge runs that only look alike", () => {
    const host = mount("abcd");

    applyInlineStyle(rangeOver(host, 0, 2), { color: "red" });
    applyInlineStyle(rangeOver(host, 2, 4), { color: "blue" });

    expect(host.innerHTML).toBe(
      '<span style="color: red">ab</span><span style="color: blue">cd</span>',
    );
  });

  it("leaves no empty span behind when the last style is taken off", () => {
    const host = mount("abc");

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });
    applyInlineStyle(rangeOver(host, 0, 3), { color: null });

    expect(host.innerHTML).toBe("abc");
  });

  it("keeps a property the new styling does not mention", () => {
    const host = mount("abc");

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });
    applyInlineStyle(rangeOver(host, 0, 3), { "font-weight": "700" });

    expect(host.innerHTML).toContain("color: red");
    expect(host.innerHTML).toContain("font-weight: 700");
    expect(host.querySelectorAll("span")).toHaveLength(1);
  });

  it("styles across the boundary of a run that is already styled", () => {
    const host = mount("abcdef");
    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });

    applyInlineStyle(rangeOver(host, 1, 5), { "font-weight": "700" });

    expect(host.textContent).toBe("abcdef");
    expect(host.innerHTML).toContain("font-weight: 700");
  });

  it("leaves the selection over the characters it just styled", () => {
    const host = mount("hello world");

    applyInlineStyle(rangeOver(host, 0, 5), { color: "red" });

    expect(document.getSelection()?.toString()).toBe("hello");
  });

  it("styles more than one property at once", () => {
    const host = mount("abc");

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red", "font-style": "italic" });

    expect(host.innerHTML).toContain("color: red");
    expect(host.innerHTML).toContain("font-style: italic");
  });
});

// The rebuild is what keeps the markup from growing: whatever shape the
// element was in going in, it comes out as one span per distinct run.
describe("applyInlineStyle rebuilds rather than wraps", () => {
  it("flattens markup that was already nested", () => {
    const host = mount('<span style="color: red"><span style="color: red">abc</span></span>');

    applyInlineStyle(rangeOver(host, 0, 3), { "font-style": "italic" });

    expect(host.querySelectorAll("span")).toHaveLength(1);
    expect(host.textContent).toBe("abc");
  });

  it("leaves no span carrying nothing", () => {
    const host = mount('a<span style="color: red"></span>b');

    applyInlineStyle(rangeOver(host, 0, 2), { "font-style": "italic" });

    expect(host.querySelectorAll("span")).toHaveLength(1);
    expect(host.textContent).toBe("ab");
  });

  it("reads a bold tag as styling and writes it back as one span", () => {
    const host = mount("<b>abc</b>");

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });

    expect(host.querySelector("span")?.getAttribute("style")).toContain("font-weight: 700");
    expect(host.querySelector("span")?.getAttribute("style")).toContain("color: red");
  });

  it("keeps line breaks where they were", () => {
    const host = mount("ab<br>cd");

    applyInlineStyle(rangeOver(host, 0, 2), { color: "red" });

    expect(host.querySelectorAll("br")).toHaveLength(1);
    expect(host.innerHTML).toBe('<span style="color: red">ab</span><br>cd');
  });

  // The bug: a chip is `display: flex`, so each span became its own flex item.
  // Colouring one word broke the centring and rewrapped the whole line.
  it("keeps a flex container's text as one item, so colouring a word cannot reflow it", () => {
    const host = mount("Hello this is a test to see how this work");
    host.style.display = "flex";

    applyInlineStyle(rangeOver(host, 28, 31), { color: "red" });

    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild?.tagName).toBe("SPAN");
    expect(host.firstElementChild?.getAttribute("style")).toBeNull();
    expect(host.querySelector("span span")?.textContent).toBe("how");
    expect(host.textContent).toBe("Hello this is a test to see how this work");
  });

  it("does the same for a grid container", () => {
    const host = mount("abcdef");
    host.style.display = "grid";

    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.children).toHaveLength(1);
  });

  it("does not wrap an ordinary block, which flows its text already", () => {
    const host = mount("abcdef");

    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.innerHTML).toBe('ab<span style="color: red">cd</span>ef');
  });

  it("reads styling back out of the wrapper it added", () => {
    const host = mount("abcdef");
    host.style.display = "flex";
    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    applyInlineStyle(rangeOver(host, 2, 4), { color: "blue" });

    expect(host.querySelectorAll("span span")).toHaveLength(1);
    expect(host.querySelector("span span")?.getAttribute("style")).toBe("color: blue");
    expect(host.textContent).toBe("abcdef");
  });

  it("styles a run that sits after a line break", () => {
    const host = mount("ab<br>cd");

    applyInlineStyle(rangeOver(host, 3, 5), { color: "red" });

    expect(host.innerHTML).toBe('ab<br><span style="color: red">cd</span>');
  });
});

describe("readInlineStyle", () => {
  it("reports the styling of a run that is styled the same throughout", () => {
    const host = mount('<span style="color: rgb(255, 0, 0)">abc</span>');

    const styles = readInlineStyle(rangeOver(host, 0, 3), ["color"]);

    expect(styles.color).toBe("rgb(255, 0, 0)");
  });

  it("reports nothing for a property that is not set anywhere", () => {
    const host = mount("abc");

    const styles = readInlineStyle(rangeOver(host, 0, 3), ["background-color"]);

    expect(styles["background-color"]).toBeUndefined();
  });

  it("reports the character before a collapsed caret at a style boundary", () => {
    const host = mount('<span style="color: red">ab</span>cd');

    const styles = readInlineStyle(rangeOver(host, 2, 2), ["color"]);

    expect(styles.color).toBe("red");
  });
});

// Edge cases found by asking what a real composition contains that the happy
// path does not: source formatting, containers that box their children, text
// that is not plain ASCII, and a selection that reaches outside the element.
describe("applyInlineStyle edge cases", () => {
  it("keeps a newline that came from the source file as text, not a line break", () => {
    // Compositions are written across lines. Turning that whitespace into <br>
    // would add visible breaks to an element that had none.
    const host = mount("\n      Hello world\n    ");

    applyInlineStyle(rangeOver(host, 7, 12), { color: "red" });

    expect(host.querySelectorAll("br")).toHaveLength(0);
    expect(host.textContent).toBe("\n      Hello world\n    ");
  });

  it("still writes a real line break back as a line break", () => {
    const host = mount("ab<br>cd");

    applyInlineStyle(rangeOver(host, 3, 5), { color: "red" });

    expect(host.querySelectorAll("br")).toHaveLength(1);
    expect(host.textContent).toBe("abcd");
  });

  it("keeps text that looks like markup as text", () => {
    const host = mount("a &lt;b&gt; &amp; c");

    applyInlineStyle(rangeOver(host, 0, 1), { color: "red" });

    expect(host.textContent).toBe("a <b> & c");
    expect(host.querySelectorAll("b")).toHaveLength(0);
  });

  it.each(["a", "sub", "sup", "mark", "s"])(
    "unwraps unsupported <%s> markup exactly as the persistence sanitizer does",
    (tag) => {
      const host = mount(`<${tag} href="https://example.com" style="color: red">abc</${tag}>`);
      host.contentEditable = "true";

      applyInlineStyle(rangeOver(host, 0, 3), { "font-weight": "700" });

      expect(host.querySelector(tag)).toBeNull();
      expect(host.innerHTML).not.toContain("href");
      expect(host.innerHTML).not.toContain("color: red");
      expect(host.innerHTML).toContain("font-weight: 700");
    },
  );

  it("does not cut an emoji in half when the boundary lands inside one", () => {
    // A selection offset is counted in UTF-16 units, and an emoji is two of
    // them. Splitting one leaves half a character in each span.
    const host = mount("ab👍cd");

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });

    expect(host.textContent).toBe("ab👍cd");
    // textContent would read back whole even if the two halves sat in separate
    // spans, so the check that matters is that no element holds half a one.
    expect(elementsWithHalfACharacter(host)).toEqual([]);
  });

  it("keeps a whole emoji together when the selection starts inside one", () => {
    const host = mount("ab👍cd");

    applyInlineStyle(rangeOver(host, 3, 6), { color: "red" });

    expect(host.textContent).toBe("ab👍cd");
    expect(elementsWithHalfACharacter(host)).toEqual([]);
  });

  it.each([
    ["a zero-width-joiner family", "👨‍👩‍👧"],
    ["a regional-indicator flag", "🇺🇸"],
    ["an emoji with a skin-tone modifier", "👍🏽"],
    ["a combining-mark character", "e\u0301"],
  ])("keeps %s together", (_name, grapheme) => {
    const host = mount(`a${grapheme}b`);
    // Both boundaries are expressed in UTF-16 units and at least one lands
    // inside the grapheme rather than at one of its edges.
    applyInlineStyle(rangeOver(host, 2, Math.max(3, grapheme.length)), { color: "red" });

    expect(host.innerHTML).toBe(`a<span style="color: red">${grapheme}</span>b`);
  });

  it("leaves the element alone when the selection reaches outside it", () => {
    // Rebuilding on a range whose common ancestor is an ancestor of the element
    // would rewrite far more of the document than the user selected.
    document.body.innerHTML = '<section><h1 id="a">first</h1><h1 id="b">second</h1></section>';
    const section = document.body.firstElementChild as HTMLElement;
    const before = section.innerHTML;
    const range = document.createRange();
    range.setStart(section.querySelector("#a")!.firstChild!, 1);
    range.setEnd(section.querySelector("#b")!.firstChild!, 2);

    applyInlineStyle(range, { color: "red" });

    expect(section.innerHTML).toBe(before);
  });

  it("counts a nested line break in a range whose boundaries are child indexes", () => {
    const host = mount("a<span>b<br>c</span>d");
    const range = document.createRange();
    range.setStart(host, 1);
    range.setEnd(host, 2);

    applyInlineStyle(range, { color: "red" });

    expect(Array.from(host.querySelectorAll("span")).map((span) => span.textContent)).toEqual([
      "b",
      "c",
    ]);
    expect(host.innerHTML.endsWith("d")).toBe(true);
  });

  it("walks deeply nested formatting without using the call stack", () => {
    const host = mount("");
    let parent = host;
    for (let depth = 0; depth < 2_000; depth += 1) {
      const span = document.createElement("span");
      parent.append(span);
      parent = span;
    }
    parent.textContent = "x";

    applyInlineStyle(rangeOver(host, 0, 1), { color: "red" });

    expect(host.textContent).toBe("x");
    expect(host.querySelectorAll("span")).toHaveLength(1);
  });

  it("keeps a line-clamped element's text as one item", () => {
    // -webkit-box is how line clamping is written, and it boxes its children
    // exactly like flex does.
    const host = mount("abcdef");
    host.style.display = "-webkit-box";

    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.children).toHaveLength(1);
  });

  it("styles the whole text when everything is selected", () => {
    const host = mount("abcdef");

    applyInlineStyle(rangeOver(host, 0, 6), { color: "red" });

    expect(host.innerHTML).toBe('<span style="color: red">abcdef</span>');
  });

  it("styles right up to an existing run's edge without merging into it", () => {
    const host = mount("abcd");
    applyInlineStyle(rangeOver(host, 0, 2), { color: "red" });

    applyInlineStyle(rangeOver(host, 2, 4), { "font-style": "italic" });

    expect(host.querySelectorAll("span")).toHaveLength(2);
    expect(host.textContent).toBe("abcd");
  });

  it("survives being asked to style the same run twice over", () => {
    const host = mount("abcdef");
    for (let round = 0; round < 5; round += 1) {
      applyInlineStyle(rangeOver(host, 1, 4), { color: "red" });
    }

    expect(host.querySelectorAll("span")).toHaveLength(1);
    expect(host.textContent).toBe("abcdef");
  });
});

/**
 * An element's children are not always anonymous formatting. The design panel
 * keeps them as text layers and tracks each by an attribute on it, so a rebuild
 * that emits fresh bare spans throws that identity away — and after colouring a
 * single word the panel could no longer match a layer to its source, so every
 * edit it offered failed with "Couldn't save this text structure change".
 */
describe("applyInlineStyle keeps what the design panel tracks", () => {
  it("keeps a layer's key when the styling changes", () => {
    const host = mount(
      '<span data-hf-text-key="child:0" style="color: red">Hello</span>' +
        '<span data-hf-text-key="child:1" style="color: blue">world</span>',
    );
    applyInlineStyle(rangeOver(host, 0, 5), { color: "green" });

    expect(host.innerHTML).toContain('data-hf-text-key="child:0"');
    expect(host.innerHTML).toContain('data-hf-text-key="child:1"');
    expect(host.innerHTML).toContain("color: green");
  });

  it("keeps a layer's typography, which the edit never mentioned", () => {
    const host = mount(
      '<span data-hf-text-key="child:0" style="font-size: 48px; color: red">Hello</span>',
    );
    applyInlineStyle(rangeOver(host, 0, 5), { color: "green" });

    expect(host.innerHTML).toContain("font-size: 48px");
  });

  it("does not put one layer's key on two spans when its text is split", () => {
    const host = mount('<span data-hf-text-key="child:0">Hello</span>');
    applyInlineStyle(rangeOver(host, 0, 2), { color: "green" });

    expect(host.innerHTML.match(/data-hf-text-key="child:0"/g) ?? []).toHaveLength(1);
  });

  it("still merges neighbours that carry no identity to lose", () => {
    const host = mount('<span style="color: red">ab</span>cd');
    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.innerHTML).toBe('<span style="color: red">abcd</span>');
  });

  // The wrapper the rebuild adds inside a flex container carries nothing. Read
  // as the layer it sits around, it hid the real one below it, and the second
  // edit of an element threw away every identity the first one had kept.
  it("keeps a layer's identity through a second edit inside a flex container", () => {
    document.body.innerHTML =
      '<div style="display: flex" contenteditable="true">' +
      '<span data-hf-text-key="child:0">one<br>two</span></div>';
    const host = document.body.firstElementChild as HTMLElement;
    applyInlineStyle(rangeOver(host, 4, 6), { color: "red" });
    const live = document.getSelection()?.getRangeAt(0);
    if (live) applyInlineStyle(live, { color: "blue" });

    expect(host.innerHTML).toContain('data-hf-text-key="child:0"');
    expect(host.innerHTML).toContain("color: blue");
    expect(host.innerHTML).not.toContain("color: red");
  });

  // Stamped by the writer on every element on the way to disk, so carrying it
  // preserves nothing — and it made the wrapper this rebuild adds look like a
  // layer as soon as the file had been saved once.
  it("does not treat the writer's own id as a layer identity", () => {
    document.body.innerHTML =
      '<div style="display: flex" contenteditable="true">' +
      '<span data-hf-id="hf-wrap"><span data-hf-text-key="child:0">one<br>two</span></span></div>';
    const host = document.body.firstElementChild as HTMLElement;
    applyInlineStyle(rangeOver(host, 4, 6), { color: "red" });

    expect(host.innerHTML).toContain('data-hf-text-key="child:0"');
    expect(host.innerHTML).not.toContain("hf-wrap");
  });

  it("does not carry attributes that the persistence sanitizer will remove", () => {
    const host = mount(
      '<span data-hf-text-key="child:0" aria-label="stale" onclick="alert(1)">abc</span>',
    );

    applyInlineStyle(rangeOver(host, 0, 3), { color: "red" });

    expect(host.innerHTML).toContain('data-hf-text-key="child:0"');
    expect(host.innerHTML).not.toContain("aria-label");
    expect(host.innerHTML).not.toContain("onclick");
  });

  it("does not carry style properties that the persistence sanitizer will remove", () => {
    const host = mount('<span style="color: red; text-transform: uppercase">abc</span>');

    applyInlineStyle(rangeOver(host, 0, 3), { "font-weight": "700" });

    expect(host.innerHTML).toBe('<span style="color: red; font-weight: 700">abc</span>');
  });

  it("does not edit through a contenteditable=false boundary", () => {
    document.body.innerHTML =
      '<div contenteditable="true"><span contenteditable="false">locked</span></div>';
    const locked = document.body.querySelector("span") as HTMLElement;

    applyInlineStyle(rangeOver(locked, 0, 6), { color: "red" });

    expect(locked.innerHTML).toBe("locked");
  });

  it("does not merge two tracked layers that end up looking alike", () => {
    const host = mount(
      '<span data-hf-text-key="child:0" style="color: red">ab</span>' +
        '<span data-hf-text-key="child:1" style="color: blue">cd</span>',
    );
    applyInlineStyle(rangeOver(host, 2, 4), { color: "red" });

    expect(host.innerHTML).toContain('data-hf-text-key="child:0"');
    expect(host.innerHTML).toContain('data-hf-text-key="child:1"');
  });

  it("cannot merge identities through delimiter-bearing attribute values", () => {
    const host = mount(
      '<span data-hf-text-key="a&amp;data-hf-text-key=b">ab</span>' +
        '<span data-hf-text-key="b">cd</span>',
    );

    applyInlineStyle(rangeOver(host, 0, 4), { color: "red" });

    expect(host.querySelectorAll("span")).toHaveLength(2);
    expect(host.querySelectorAll('[data-hf-text-key="b"]')).toHaveLength(1);
    expect(host.innerHTML).not.toContain("a&amp;");
  });
});

/**
 * A control that fires more than once per gesture, which the colour input does:
 * a native picker reports every sample while the pointer moves in it, so one
 * choice of colour arrives as a stream of them, each applied to whatever is
 * selected at the time.
 */
describe("applyInlineStyle survives a control that fires repeatedly", () => {
  it("restyles the same characters each time, in text containing a line break", () => {
    const host = mount("1.<br>abcdefg");
    // "cde", on the line after the break. Only the first sample knows where the
    // user pointed; every one after it reads the selection back, which is what
    // the toolbar does and what the restore has to have got right.
    applyInlineStyle(rangeOver(host, 5, 8), { color: "rgb(1, 1, 1)" });
    for (const color of ["rgb(2, 2, 2)", "rgb(3, 3, 3)"]) {
      const live = document.getSelection()?.getRangeAt(0);
      if (live) applyInlineStyle(live, { color });
    }

    expect(host.innerHTML).toBe('1.<br>ab<span style="color: rgb(3, 3, 3)">cde</span>fg');
  });

  it("puts the selection back over the characters it styled, past a break", () => {
    const host = mount("1.<br>abcdefg");
    applyInlineStyle(rangeOver(host, 5, 8), { color: "red" });

    expect(document.getSelection()?.toString()).toBe("cde");
  });
});

/**
 * A colour that does not paint is the same to the user as one that did not save.
 *
 * `-webkit-text-fill-color` inherits and paints the glyph fill, so a composition
 * that sets it on a text element wins over any `color` the editor puts on a run
 * inside it. The run saved correctly and rendered in someone else's colour,
 * which reads as the colour picker being broken.
 */
describe("applyInlineStyle when something else is painting the glyphs", () => {
  function stubFill(fill: string | null | ((element: HTMLElement) => string | null)) {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
      const computed = real(element as HTMLElement);
      const resolvedFill = typeof fill === "function" ? fill(element as HTMLElement) : fill;
      return new Proxy(computed, {
        get: (target, key) => {
          if (key === "webkitTextFillColor") return resolvedFill ?? undefined;
          if (key === "color") return (element as HTMLElement).style.color || "rgb(0, 0, 0)";
          return Reflect.get(target, key);
        },
      });
    }) as typeof window.getComputedStyle);
  }

  it("mirrors the colour into the fill when an ancestor is overpainting", () => {
    const host = mount("Hello world");
    stubFill("rgb(255, 255, 255)");
    applyInlineStyle(rangeOver(host, 6, 11), { color: "rgb(255, 0, 149)" });

    expect(host.innerHTML).toContain("-webkit-text-fill-color: rgb(255, 0, 149)");
    expect(host.innerHTML).toContain("color: rgb(255, 0, 149)");
  });

  it("leaves the markup alone when nothing is overpainting", () => {
    const host = mount("Hello world");
    stubFill("rgb(255, 0, 149)");
    applyInlineStyle(rangeOver(host, 6, 11), { color: "rgb(255, 0, 149)" });

    expect(host.innerHTML).not.toContain("-webkit-text-fill-color");
    expect(host.innerHTML).toContain("color: rgb(255, 0, 149)");
  });

  it("says nothing about a run that carries no colour", () => {
    const host = mount("Hello world");
    stubFill("rgb(255, 255, 255)");
    applyInlineStyle(rangeOver(host, 6, 11), { "font-weight": "700" });

    expect(host.innerHTML).not.toContain("-webkit-text-fill-color");
  });

  it("mirrors only the run whose own ancestor path is overpainting", () => {
    const host = mount(
      '<span data-hf-text-key="child:0" style="color: blue">left</span>' +
        '<span data-hf-text-key="child:1" style="color: green">right</span>',
    );
    stubFill((element) =>
      element.textContent === "left" ? "rgb(255, 255, 255)" : element.style.color,
    );

    applyInlineStyle(rangeOver(host, 4, 9), { color: "red" });

    const [left, right] = Array.from(host.querySelectorAll<HTMLElement>("span"));
    expect(left?.style.getPropertyValue("-webkit-text-fill-color")).toBe("blue");
    expect(right?.style.getPropertyValue("-webkit-text-fill-color")).toBe("");
  });

  it("drops a generated mirror when the ancestor stops overpainting", () => {
    const host = mount("Hello world");
    let overpainted = true;
    stubFill((element) => (overpainted ? "rgb(255, 255, 255)" : element.style.color));
    applyInlineStyle(rangeOver(host, 6, 11), { color: "red" });
    expect(host.innerHTML).toContain("-webkit-text-fill-color");

    overpainted = false;
    const live = document.getSelection()?.getRangeAt(0);
    if (live) applyInlineStyle(live, { "font-weight": "700" });

    expect(host.innerHTML).not.toContain("-webkit-text-fill-color");
  });
});

describe("readInlineStyleSpread", () => {
  it("reports every distinct colour in the selection, in order", () => {
    const host = mount(
      '<span style="color: red">Hello</span><span style="color: lime">world</span>',
    );

    expect(readInlineStyleSpread(rangeOver(host, 0, 10), "color")).toEqual(["red", "lime"]);
  });

  it("reports a colour once, however many characters carry it", () => {
    const host = mount('<span style="color: red">He</span><span style="color: red">llo</span>');

    expect(readInlineStyleSpread(rangeOver(host, 0, 5), "color")).toEqual(["red"]);
  });

  it("reports only what the selection covers", () => {
    const host = mount(
      '<span style="color: red">Hello</span><span style="color: lime">world</span>',
    );

    expect(readInlineStyleSpread(rangeOver(host, 6, 10), "color")).toEqual(["lime"]);
  });

  it("ignores whitespace, which shows no colour at all", () => {
    // Colour the whole element, then recolour one word: the whitespace around it
    // keeps the first colour. It paints no glyph, so counting it puts a band of a
    // colour nothing on screen is painted in at the edge of the swatch.
    const host = mount(
      '<span style="color: lime"> </span>' +
        '<span style="color: red">Hello</span>' +
        '<span style="color: lime"> world</span>',
    );

    expect(readInlineStyleSpread(rangeOver(host, 0, 12), "color")).toEqual(["red", "lime"]);
  });

  it("is empty when the characters carry no colour of their own", () => {
    const host = mount("Hello world");

    expect(readInlineStyleSpread(rangeOver(host, 0, 5), "color")).toEqual([]);
  });
});
