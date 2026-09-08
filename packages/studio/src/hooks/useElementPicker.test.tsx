// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElementPicker } from "./useElementPicker";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type Picker = ReturnType<typeof useElementPicker>;

/** One handle per render, so the assertions read a list instead of a mutated binding. */
const rendered: Picker[] = [];

function Probe({ options }: { options?: Parameters<typeof useElementPicker>[1] }) {
  rendered.push(useElementPicker({ current: primary }, options));
  return null;
}

function latest(): Picker {
  const handle = rendered[rendered.length - 1];
  if (!handle) throw new Error("hook did not render");
  return handle;
}

let primary: HTMLIFrameElement;
let override: HTMLIFrameElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  rendered.length = 0;
  primary = document.createElement("iframe");
  override = document.createElement("iframe");
  document.body.append(primary, override);
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("useElementPicker", () => {
  it("points activeIframeRef at the preview iframe by default", () => {
    act(() => root.render(<Probe />));

    expect(latest().activeIframeRef.current).toBe(primary);
  });

  it("follows the zoomed frame once an override is set and the app re-renders", () => {
    act(() => root.render(<Probe />));

    act(() => {
      latest().setActiveIframe(override);
      root.render(<Probe />);
    });

    expect(latest().activeIframeRef.current).toBe(override);
  });

  it("patches source through the options given to the newest render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const files = { "index.html": `<div id="card">card</div>` };
    primary.contentDocument!.body.innerHTML = `<div id="card">card</div>`;

    act(() => root.render(<Probe options={{ workspaceFiles: files, onSyncFiles: first }} />));
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: primary.contentWindow,
          data: {
            source: "hf-preview",
            type: "element-picked",
            elementInfo: { id: "card", tagName: "div", selector: "#card" },
          },
        }),
      );
    });
    expect(latest().pickedElement?.id).toBe("card");

    act(() => root.render(<Probe options={{ workspaceFiles: files, onSyncFiles: second }} />));
    act(() => latest().setStyle("color", "red"));

    // The newest render's callback, not the one the hook first mounted with:
    // an inline-style edit has to reach the file map the app currently holds.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({
      "index.html": expect.stringContaining("color: red"),
    });
  });
});
