import { afterEach, describe, expect, it, vi } from "vitest";
import { handleFor } from "../editingHandles";
import { MAX_EDIT_VALUE } from "./editElement";
import { endTextEdit, parseTextEdit, textEdit, textEditEndedEvent } from "./textEdit";

const V = 1;
const HANDLE = "0123456789abcdef:1";

afterEach(() => {
  endTextEdit();
  parent = port();
  document.body.innerHTML = "";
});

function page(markup = "Hello <b>world</b>") {
  document.body.innerHTML = `<p id="title" style="outline: 1px dotted red">${markup}</p><p id="other">x</p>`;
  const element = document.getElementById("title")!;
  return { element, handle: handleFor(element) };
}

const port = () =>
  ({ postMessage: vi.fn() }) as unknown as MessagePort & { postMessage: ReturnType<typeof vi.fn> };
let parent = port();
const start = (handle: string, on: MessagePort = parent) =>
  textEdit({ handle, action: "start", caret: null }, on, V);
const end = (handle: string, keep: boolean, on: MessagePort = parent) =>
  textEdit({ handle, action: "end", keep }, on, V);
const key = (element: Element, init: KeyboardEventInit) =>
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

describe("text-edit", () => {
  it("takes a start with a caret or none, and an end that keeps or not", () => {
    expect(
      parseTextEdit({ handle: HANDLE, action: "start", caret: { x: 1, y: 2 } }),
    ).not.toBeNull();
    expect(parseTextEdit({ handle: HANDLE, action: "start", caret: null })).not.toBeNull();
    expect(parseTextEdit({ handle: HANDLE, action: "end", keep: true })).not.toBeNull();
    expect(parseTextEdit({ handle: HANDLE, action: "end", keep: "yes" })).toBeNull();
    expect(parseTextEdit({ handle: HANDLE, action: "start", caret: null, html: "x" })).toBeNull();
    expect(parseTextEdit({ handle: "#title", action: "end", keep: true })).toBeNull();
  });

  it("opens the element for typing and closes it keeping clean markup", () => {
    const { element, handle } = page();
    expect(start(handle)).toEqual({ applied: true, html: null, previous: "Hello <b>world</b>" });
    expect(element.getAttribute("contenteditable")).toBe("true");
    element.innerHTML = `Hi <b onclick="x()">there</b>`;
    expect(end(handle, true)).toEqual({
      applied: true,
      html: "Hi <b>there</b>",
      previous: "Hello <b>world</b>",
    });
    expect(element.hasAttribute("contenteditable")).toBe(false);
    expect(element.style.outline).toBe("1px dotted red");
  });

  it("puts the original back when the parent ends without keeping", () => {
    const { element, handle } = page();
    start(handle);
    element.textContent = "typed";
    expect(end(handle, false)).toEqual({
      applied: true,
      html: null,
      previous: "Hello <b>world</b>",
    });
    expect(element.innerHTML).toBe("Hello <b>world</b>");
  });

  it("refuses an element whose markup is not text", () => {
    const { element, handle } = page(`<a href="https://x.test">link</a>`);
    expect(start(handle)).toEqual({ applied: false, html: null, previous: null });
    expect(element.hasAttribute("contenteditable")).toBe(false);
  });

  it("puts the original back and keeps nothing when the typed markup is refused", () => {
    const { element, handle } = page();
    start(handle);
    element.textContent = "x".repeat(MAX_EDIT_VALUE + 1);
    expect(end(handle, true)).toMatchObject({ applied: true, html: null });
    expect(element.innerHTML).toBe("Hello <b>world</b>");
  });

  it("answers an end with no session, or for another element, without closing anything", () => {
    const { element, handle } = page();
    expect(end(handle, true)).toEqual({ applied: false, html: null, previous: null });
    start(handle);
    expect(end(handleFor(document.getElementById("other")!), true)).toEqual({
      applied: false,
      html: null,
      previous: null,
    });
    expect(element.getAttribute("contenteditable")).toBe("true");
  });

  it("ends an open session with its original back when another start arrives", () => {
    const { element, handle } = page();
    start(handle);
    element.textContent = "typed";
    start(handleFor(document.getElementById("other")!));
    expect(element.innerHTML).toBe("Hello <b>world</b>");
    expect(element.hasAttribute("contenteditable")).toBe(false);
  });

  it("ends on its own when the element leaves the page or the page hides", async () => {
    const { element, handle } = page();
    start(handle);
    element.remove();
    await new Promise((resolve) => setTimeout(resolve));
    expect(end(handle, true).applied).toBe(false);
    const again = page();
    start(again.handle);
    again.element.textContent = "typed";
    window.dispatchEvent(new Event("pagehide"));
    expect(again.element.innerHTML).toBe("Hello <b>world</b>");
    expect(end(again.handle, true).applied).toBe(false);
  });

  it("ends on Enter or Escape keeping the text, and tells only the port that started it", () => {
    for (const init of [{ key: "Enter" }, { key: "Escape" }]) {
      const { element, handle } = page();
      const starter = port();
      const other = port();
      start(handle, starter);
      element.innerHTML = "Hi <i>there</i>";
      expect(key(element, init)).toBe(false);
      expect(starter.postMessage).toHaveBeenCalledWith({
        v: V,
        event: "text-edit-ended",
        handle,
        html: "Hi <i>there</i>",
        previous: "Hello <b>world</b>",
      });
      expect(other.postMessage).not.toHaveBeenCalled();
      expect(element.hasAttribute("contenteditable")).toBe(false);
    }
  });

  it("leaves Shift+Enter to the element as a line break", () => {
    const { element, handle } = page();
    const starter = port();
    start(handle, starter);
    expect(key(element, { key: "Enter", shiftKey: true })).toBe(true);
    expect(starter.postMessage).not.toHaveBeenCalled();
  });

  it("tells the parent the original came back when Enter ends on refused markup", () => {
    const { element, handle } = page();
    const starter = port();
    start(handle, starter);
    element.textContent = "x".repeat(MAX_EDIT_VALUE + 1);
    key(element, { key: "Enter" });
    expect(starter.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ html: null, previous: "Hello <b>world</b>" }),
    );
    expect(element.innerHTML).toBe("Hello <b>world</b>");
  });

  it("puts back a removed element's original, so putting the element back shows no draft", async () => {
    const { element, handle } = page();
    start(handle);
    element.textContent = "unsaved";
    element.remove();
    await new Promise((resolve) => setTimeout(resolve));
    document.body.append(element);
    expect(element.innerHTML).toBe("Hello <b>world</b>");
    expect(element.hasAttribute("contenteditable")).toBe(false);
    expect(element.style.outline).toBe("1px dotted red");
  });

  it("lets only the port that started a session end it", () => {
    const { element, handle } = page();
    start(handle);
    element.textContent = "draft";
    expect(end(handle, true, port())).toEqual({ applied: false, html: null, previous: null });
    expect(element.getAttribute("contenteditable")).toBe("true");
    expect(end(handle, true)).toMatchObject({ applied: true, html: "draft" });
  });

  it("takes paste and drop as plain text only", () => {
    const { element, handle } = page();
    start(handle);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    expect(element.dispatchEvent(paste)).toBe(false);
    expect(element.dispatchEvent(drop)).toBe(false);
  });

  it("reads an ended event only in its exact shape", () => {
    const event = { v: V, event: "text-edit-ended", handle: HANDLE, html: "a", previous: "b" };
    expect(textEditEndedEvent(event, V)).toEqual({ handle: HANDLE, html: "a", previous: "b" });
    expect(textEditEndedEvent({ ...event, html: null }, V)).not.toBeNull();
    expect(textEditEndedEvent({ ...event, extra: 1 }, V)).toBeNull();
    expect(textEditEndedEvent({ ...event, v: 2 }, V)).toBeNull();
    expect(textEditEndedEvent({ ...event, previous: null }, V)).toBeNull();
  });
});
