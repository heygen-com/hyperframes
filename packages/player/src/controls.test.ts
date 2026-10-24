import { describe, it, expect, vi } from "vitest";
import { type ControlsCallbacks, createControls } from "./controls";

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
