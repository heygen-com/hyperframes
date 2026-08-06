// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { applyInlineStyle, readInlineStyle } from "./inlineTextStyleRange";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<h1>${html}</h1>`;
  return document.body.firstElementChild as HTMLElement;
}

/** A range over the host's text, by character offsets across the whole element. */
function rangeOver(host: HTMLElement, start: number, end: number): Range {
  const range = document.createRange();
  // A line break counts as one character, the same way the module does.
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let seen = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 1 && (node as Element).tagName !== "BR") {
      node = walker.nextNode();
      continue;
    }
    const length = node.nodeType === 1 ? 1 : (node.textContent?.length ?? 0);
    // A break is counted but never landed on: a boundary there belongs to the
    // text beside it, which is where a real selection would put it too.
    if (node.nodeType === 1) {
      seen += length;
      node = walker.nextNode();
      continue;
    }
    if (!startSet && seen + length >= start) {
      range.setStart(node, start - seen);
      startSet = true;
    }
    if (startSet && seen + length >= end) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
    node = walker.nextNode();
  }
  return range;
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
});
