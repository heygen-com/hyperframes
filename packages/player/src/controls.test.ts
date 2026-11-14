import { describe, it, expect, vi, afterEach } from "vitest";
import { type ControlsCallbacks, createControls } from "./controls";
import { FULLSCREEN_ENTER_ICON, FULLSCREEN_EXIT_ICON } from "./styles";

function noopCallbacks(): ControlsCallbacks {
  return {
    onPlay: () => {},
    onPause: () => {},
    onSeek: () => {},
    onSpeedChange: () => {},
    onMuteToggle: () => {},
    onVolumeChange: () => {},
  };
}

describe("createControls host listeners", () => {
  it("removes every host listener it added on destroy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const addSpy = vi.spyOn(host, "addEventListener");
    const removeSpy = vi.spyOn(host, "removeEventListener");

    const api = createControls(host, noopCallbacks());

    // Capture the exact handler references registered on the host element.
    const added = new Map<string, EventListenerOrEventListenerObject>();
    for (const [type, handler] of addSpy.mock.calls) {
      added.set(type, handler as EventListenerOrEventListenerObject);
    }
    expect(added.has("mousemove")).toBe(true);
    expect(added.has("mouseleave")).toBe(true);

    api.destroy();

    // Each host listener must be torn down with the same reference; anonymous
    // handlers (the previous bug) could never be removed, so toggling the
    // `controls` attribute leaked a duplicate pair on every cycle.
    for (const [type, handler] of added) {
      expect(removeSpy).toHaveBeenCalledWith(type, handler);
    }

    host.remove();
  });

  it("stops reacting to host mousemove after destroy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const api = createControls(host, noopCallbacks());
    const controls = host.querySelector<HTMLElement>(".hfp-controls");
    expect(controls).not.toBeNull();

    api.destroy();

    // A mousemove after destroy must not revive the controls overlay.
    controls!.classList.add("hfp-hidden");
    host.dispatchEvent(new Event("mousemove"));
    expect(controls!.classList.contains("hfp-hidden")).toBe(true);

    host.remove();
  });

  it("removes its controls element from the host on destroy", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const api = createControls(host, noopCallbacks());
    const controls = host.querySelector<HTMLElement>(".hfp-controls");
    expect(controls).not.toBeNull();

    api.destroy();

    expect(host.querySelector(".hfp-controls")).toBeNull();
    expect(controls!.isConnected).toBe(false);

    host.remove();
  });
});

describe("createControls playback speed name", () => {
  it("includes the visible rate initially and after menu and API updates", () => {
    const host = document.createElement("div");
    const onSpeedChange = vi.fn();
    const api = createControls(host, { ...noopCallbacks(), onSpeedChange });
    const speedButton = host.querySelector(".hfp-speed-btn");

    expect(speedButton?.textContent).toBe("1x");
    expect(speedButton?.getAttribute("aria-label")).toBe("Playback speed: 1x");

    const option = host.querySelector<HTMLButtonElement>('[data-speed="1.5"]');
    expect(option).not.toBeNull();
    option?.click();

    expect(speedButton?.textContent).toBe("1.5x");
    expect(speedButton?.getAttribute("aria-label")).toBe("Playback speed: 1.5x");
    expect(onSpeedChange).toHaveBeenCalledWith(1.5);

    api.updateSpeed(2);

    expect(speedButton?.textContent).toBe("2x");
    expect(speedButton?.getAttribute("aria-label")).toBe("Playback speed: 2x");

    api.destroy();
  });
});

describe("createControls idle hide", () => {
  function setup() {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = createControls(host, noopCallbacks());
    const controls = host.querySelector<HTMLElement>(".hfp-controls")!;
    return { host, api, controls };
  }

  it("hides after 3 s of no input while playing, and returns on movement", () => {
    const { host, api, controls } = setup();
    api.updatePlaying(true);
    host.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(3000);
    expect(controls.classList.contains("hfp-hidden")).toBe(true);
    host.dispatchEvent(new Event("mousemove"));
    expect(controls.classList.contains("hfp-hidden")).toBe(false);
    api.destroy();
    host.remove();
    vi.useRealTimers();
  });

  it("stays visible while paused or while a control has focus", () => {
    const { host, api, controls } = setup();
    vi.advanceTimersByTime(5000);
    expect(controls.classList.contains("hfp-hidden")).toBe(false);
    api.updatePlaying(true);
    controls.querySelector<HTMLElement>("button")!.focus();
    vi.advanceTimersByTime(5000);
    expect(controls.classList.contains("hfp-hidden")).toBe(false);
    api.destroy();
    host.remove();
    vi.useRealTimers();
  });

  it("comes back on a key press and stays visible until idle again", () => {
    const { host, api, controls } = setup();
    api.updatePlaying(true);
    vi.advanceTimersByTime(3000);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(controls.classList.contains("hfp-hidden")).toBe(false);
    vi.advanceTimersByTime(2999);
    expect(controls.classList.contains("hfp-hidden")).toBe(false);
    api.destroy();
    host.remove();
    vi.useRealTimers();
  });

  it("restarting playback state does not push the hide back", () => {
    const { host, api, controls } = setup();
    api.updatePlaying(true);
    vi.advanceTimersByTime(2000);
    api.updatePlaying(true);
    vi.advanceTimersByTime(1000);
    expect(controls.classList.contains("hfp-hidden")).toBe(true);
    api.destroy();
    host.remove();
    vi.useRealTimers();
  });
});

describe("createControls fullscreen", () => {
  const mounted: { host: HTMLElement; api: ReturnType<typeof createControls> }[] = [];

  function newHost(): HTMLElement {
    return document.body.appendChild(document.createElement("div"));
  }

  function mount(host: HTMLElement) {
    const api = createControls(host, noopCallbacks());
    mounted.push({ host, api });
    return api;
  }

  function serialized(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.innerHTML;
  }

  function fullscreenButton(host: HTMLElement): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(".hfp-fullscreen-btn");
    if (!button) throw new Error("no fullscreen button");
    return button;
  }

  function fakeFullscreen(host: HTMLElement) {
    let active = false;
    const announce = (target: EventTarget) =>
      target.dispatchEvent(new Event("fullscreenchange", { bubbles: true, composed: true }));
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    vi.spyOn(host, "matches").mockImplementation((selector: string) =>
      selector === ":fullscreen" ? active : Element.prototype.matches.call(host, selector),
    );
    const requestFullscreen = vi.fn(async () => {
      active = true;
      announce(host);
    });
    const exitFullscreen = vi.fn(async () => {
      active = false;
      announce(host);
    });
    host.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;
    return {
      requestFullscreen,
      exitFullscreen,
      outside: (next: boolean) => {
        active = next;
        announce(document);
      },
    };
  }

  afterEach(() => {
    for (const { host, api } of mounted.splice(0)) {
      api.destroy();
      host.remove();
    }
    Reflect.deleteProperty(document, "fullscreenEnabled");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
    vi.restoreAllMocks();
  });

  it("leaves the button out where the page cannot go fullscreen", () => {
    const plain = newHost();
    mount(plain);
    expect(plain.querySelector(".hfp-fullscreen-btn")).toBeNull();

    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    const refused = newHost();
    mount(refused);
    expect(refused.querySelector(".hfp-fullscreen-btn")).toBeNull();
  });

  it("adds a Full screen button as the last control", () => {
    const host = newHost();
    fakeFullscreen(host);
    mount(host);
    const button = fullscreenButton(host);

    expect(host.querySelector(".hfp-controls")?.lastElementChild).toBe(button);
    expect(button.getAttribute("aria-label")).toBe("Full screen");
    expect(button.innerHTML).toBe(serialized(FULLSCREEN_ENTER_ICON));
  });

  it("puts the host in fullscreen and back, naming the next action", () => {
    const host = newHost();
    const { requestFullscreen, exitFullscreen } = fakeFullscreen(host);
    mount(host);
    const button = fullscreenButton(host);

    button.click();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.contexts[0]).toBe(host);
    expect(button.getAttribute("aria-label")).toBe("Exit full screen");
    expect(button.innerHTML).toBe(serialized(FULLSCREEN_EXIT_ICON));

    button.click();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Full screen");
    expect(button.innerHTML).toBe(serialized(FULLSCREEN_ENTER_ICON));
  });

  it("follows fullscreen changes it did not cause", () => {
    const host = newHost();
    const { requestFullscreen, exitFullscreen, outside } = fakeFullscreen(host);
    mount(host);
    const button = fullscreenButton(host);

    outside(true);
    expect(button.getAttribute("aria-label")).toBe("Exit full screen");
    outside(false);
    expect(button.getAttribute("aria-label")).toBe("Full screen");

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.createElement("div"),
    });
    button.click();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.contexts[0]).toBe(host);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("keeps its name when the browser refuses", async () => {
    const host = newHost();
    fakeFullscreen(host);
    let requests = 0;
    host.requestFullscreen = () => {
      requests += 1;
      return Promise.reject(new TypeError("Permissions check failed"));
    };
    mount(host);
    const button = fullscreenButton(host);

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);

    expect(requests).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-label")).toBe("Full screen");
  });

  it("starts as Exit full screen when built during fullscreen", () => {
    const host = newHost();
    fakeFullscreen(host).outside(true);
    mount(host);
    const button = fullscreenButton(host);

    expect(button.getAttribute("aria-label")).toBe("Exit full screen");
    expect(button.innerHTML).toBe(serialized(FULLSCREEN_EXIT_ICON));
  });

  it("removes its fullscreenchange listener on destroy", () => {
    const host = newHost();
    fakeFullscreen(host);
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const api = createControls(host, noopCallbacks());

    const added = addSpy.mock.calls.find(([type]) => type === "fullscreenchange");
    expect(added).toBeDefined();
    api.destroy();

    expect(removeSpy).toHaveBeenCalledWith("fullscreenchange", added?.[1]);
    host.remove();
  });
});
