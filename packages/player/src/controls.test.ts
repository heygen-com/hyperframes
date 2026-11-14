import { describe, it, expect, vi } from "vitest";
import { type ControlsCallbacks, createControls } from "./controls";
import {
  PAUSE_ICON,
  PLAY_ICON,
  VOLUME_HIGH_ICON,
  VOLUME_LOW_ICON,
  VOLUME_MUTED_ICON,
} from "./styles";

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

describe("createControls page glyph slots", () => {
  function setup(...glyphSlots: string[]) {
    const host = document.createElement("div");
    const glyphs = glyphSlots.map((name) => {
      const glyph = document.createElement("span");
      glyph.slot = name;
      host.appendChild(glyph);
      return glyph;
    });
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const api = createControls(shadow, noopCallbacks());
    const cleanup = () => {
      api.destroy();
      host.remove();
    };
    return { shadow, api, glyphs, cleanup };
  }

  function slotAt(root: ParentNode, selector: string): HTMLSlotElement {
    const slot = root.querySelector(selector);
    if (!(slot instanceof HTMLSlotElement)) throw new Error(`no slot at ${selector}`);
    return slot;
  }

  function onlyAssigned(slot: HTMLSlotElement): Element | undefined {
    const assigned = slot.assignedElements();
    return assigned.length === 1 ? assigned[0] : undefined;
  }

  function markup(html: string): string {
    const parsed = document.createElement("div");
    parsed.innerHTML = html;
    return parsed.innerHTML;
  }

  it("shows today's glyphs in every named control slot when the page supplies none", () => {
    const { shadow, api, cleanup } = setup();
    const seen = new Map<string, HTMLSlotElement>();
    const record = (selector: string) => {
      const slot = slotAt(shadow, selector);
      seen.set(slot.name, slot);
    };
    record(".hfp-ico-play slot");
    record(".hfp-ico-pause slot");
    record(".hfp-mute-btn slot");
    api.updateVolume(0.2);
    record(".hfp-mute-btn slot");
    api.updateMuted(true);
    record(".hfp-mute-btn slot");

    const expected: Record<string, string> = {
      "play-icon": PLAY_ICON,
      "pause-icon": PAUSE_ICON,
      "volume-high-icon": VOLUME_HIGH_ICON,
      "volume-low-icon": VOLUME_LOW_ICON,
      "volume-muted-icon": VOLUME_MUTED_ICON,
    };
    expect([...seen.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [name, icon] of Object.entries(expected)) {
      const slot = seen.get(name);
      expect(slot?.assignedElements()).toEqual([]);
      expect(slot?.innerHTML).toBe(markup(icon));
    }
    cleanup();
  });

  it("puts the page's play and pause glyphs in the play button and still marks it playing", () => {
    const {
      shadow,
      api,
      glyphs: [play, pause],
      cleanup,
    } = setup("play-icon", "pause-icon");
    const playSlot = slotAt(shadow, ".hfp-ico-play slot");

    expect(onlyAssigned(playSlot)).toBe(play);
    expect(onlyAssigned(slotAt(shadow, ".hfp-ico-pause slot"))).toBe(pause);

    api.updatePlaying(true);
    expect(playSlot.closest(".hfp-play-btn")?.classList.contains("hfp-playing")).toBe(true);
    cleanup();
  });

  it("keeps the default volume glyphs the page left out and shows its own muted glyph", () => {
    const {
      shadow,
      api,
      glyphs: [muted],
      cleanup,
    } = setup("volume-muted-icon");
    const muteSlot = () => slotAt(shadow, ".hfp-mute-btn slot");

    expect(muteSlot().name).toBe("volume-high-icon");
    expect(muteSlot().assignedElements()).toEqual([]);

    api.updateVolume(0.2);
    expect(muteSlot().name).toBe("volume-low-icon");
    expect(muteSlot().assignedElements()).toEqual([]);

    api.updateVolume(0);
    expect(muteSlot().name).toBe("volume-low-icon");
    expect(muteSlot().assignedElements()).toEqual([]);

    api.updateMuted(true);
    expect(muteSlot().name).toBe("volume-muted-icon");
    expect(onlyAssigned(muteSlot())).toBe(muted);
    cleanup();
  });
});
