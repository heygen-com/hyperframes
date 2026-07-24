// @vitest-environment happy-dom
import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HyperframesPlayer, type HyperframesPlayerHandle } from "./player.js";

// The component dynamically imports @hyperframes/player to register the
// element; stub the module and register a lightweight test double instead so
// tests don't depend on the real player's iframe/ResizeObserver machinery.
vi.mock("@hyperframes/player", () => ({}));

class StubPlayerElement extends HTMLElement {
  play = vi.fn();
  pause = vi.fn();
  seek = vi.fn();
  stopMedia = vi.fn();
  setColorGrading = vi.fn();
  clearColorGrading = vi.fn();
  setColorGradingCompare = vi.fn();
  clearColorGradingCompare = vi.fn();
  currentTime = 1.5;
  duration = 10;
  paused = false;
  ready = true;
  scenes = [{ id: "intro", start: 0, duration: 2 }];
}

let container: HTMLDivElement;
let root: Root;

function playerElement(): StubPlayerElement {
  const el = container.querySelector("hyperframes-player");
  if (!(el instanceof StubPlayerElement)) throw new Error("player element not rendered");
  return el;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
  customElements.define("hyperframes-player", StubPlayerElement);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(ui: ReactElement) {
  await act(async () => root.render(ui));
}

describe("HyperframesPlayer", () => {
  it("mirrors props to player attributes", async () => {
    await render(
      <HyperframesPlayer
        src="./comp/index.html"
        width={1280}
        height={720}
        controls
        muted
        playbackRate={1.5}
        shaderLoading="player"
      />,
    );
    const el = playerElement();
    expect(el.getAttribute("src")).toBe("./comp/index.html");
    expect(el.getAttribute("width")).toBe("1280");
    expect(el.getAttribute("height")).toBe("720");
    expect(el.hasAttribute("controls")).toBe(true);
    expect(el.hasAttribute("muted")).toBe(true);
    expect(el.getAttribute("playback-rate")).toBe("1.5");
    expect(el.getAttribute("shader-loading")).toBe("player");
    expect(el.hasAttribute("loop")).toBe(false);
  });

  it("updates and removes attributes when props change", async () => {
    await render(<HyperframesPlayer src="./a.html" controls poster="./a.jpg" />);
    await render(<HyperframesPlayer src="./b.html" />);
    const el = playerElement();
    expect(el.getAttribute("src")).toBe("./b.html");
    expect(el.hasAttribute("controls")).toBe(false);
    expect(el.hasAttribute("poster")).toBe(false);
  });

  it("maps camelCase props to kebab-case attributes", async () => {
    await render(
      <HyperframesPlayer audioSrc="./bgm.mp3" audioLocked autoPlay shaderCaptureScale={0.5} />,
    );
    const el = playerElement();
    expect(el.getAttribute("audio-src")).toBe("./bgm.mp3");
    expect(el.hasAttribute("audio-locked")).toBe(true);
    expect(el.hasAttribute("autoplay")).toBe(true);
    expect(el.getAttribute("shader-capture-scale")).toBe("0.5");
  });

  it("applies className and style", async () => {
    await render(<HyperframesPlayer className="hero" style={{ maxWidth: "800px" }} />);
    const el = playerElement();
    expect(el.getAttribute("class")).toBe("hero");
    expect(el.style.maxWidth).toBe("800px");
  });

  it("forwards player events to callbacks", async () => {
    const onReady = vi.fn();
    const onTimeUpdate = vi.fn();
    const onEnded = vi.fn();
    await render(
      <HyperframesPlayer onReady={onReady} onTimeUpdate={onTimeUpdate} onEnded={onEnded} />,
    );
    const el = playerElement();
    await act(async () => {
      el.dispatchEvent(new CustomEvent("ready", { detail: { duration: 12 } }));
      el.dispatchEvent(new CustomEvent("timeupdate", { detail: { currentTime: 3 } }));
      el.dispatchEvent(new Event("ended"));
    });
    expect(onReady).toHaveBeenCalledWith({ duration: 12 });
    expect(onTimeUpdate).toHaveBeenCalledWith({ currentTime: 3 });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("uses the latest callback without rebinding listeners", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await render(<HyperframesPlayer onPlay={first} />);
    await render(<HyperframesPlayer onPlay={second} />);
    await act(async () => playerElement().dispatchEvent(new Event("play")));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("exposes playback control and state through the ref handle", async () => {
    const ref = createRef<HyperframesPlayerHandle>();
    await render(<HyperframesPlayer ref={ref} />);
    const el = playerElement();
    ref.current?.play();
    ref.current?.seek(2.5);
    ref.current?.setColorGrading("main", { exposure: 1 });
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.seek).toHaveBeenCalledWith(2.5);
    expect(el.setColorGrading).toHaveBeenCalledWith("main", { exposure: 1 });
    expect(ref.current?.element).toBe(el);
    expect(ref.current?.currentTime).toBe(1.5);
    expect(ref.current?.duration).toBe(10);
    expect(ref.current?.ready).toBe(true);
    expect(ref.current?.scenes).toEqual([{ id: "intro", start: 0, duration: 2 }]);
  });
});
