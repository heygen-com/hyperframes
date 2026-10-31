// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { RenderQueue, type StartRenderHandler } from "./RenderQueue";
import { getPersistedRenderSettings } from "./renderSettings";
import { buttonBase, buttonSizes, buttonVariants, cn } from "../ui";
import { isTypingTarget } from "../../utils/typingTarget";
import { shouldIgnorePlaybackShortcutTarget } from "../../player/lib/playbackShortcuts";
import type { FfmpegStatus } from "./useFfmpegStatus";

// Encoder availability arrives as a prop (useRenderQueue owns the probe), so
// each case just states the environment it is about.
let ffmpegStatus: FfmpegStatus | null = { ok: true };
const recheck = vi.fn();

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

beforeEach(() => {
  ffmpegStatus = { ok: true };
  recheck.mockClear();
  // The format, frame-rate and quality controls write through to the real
  // store, so each case has to start from the shipped defaults.
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mountRenderQueue(
  onStartRender: Mock<StartRenderHandler>,
  compositionDimensions = { width: 1920, height: 1080 },
  isRendering = false,
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <RenderQueue
        jobs={[]}
        projectId="demo"
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
        onStartRender={onStartRender}
        isRendering={isRendering}
        compositionDimensions={compositionDimensions}
        ffmpeg={ffmpegStatus}
        ffmpegChecking={false}
        onRecheckFfmpeg={recheck}
      />,
    );
  });
  return host;
}

/** Base UI moves focus a task later than React renders; happy-dom is no faster. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

function fire(el: Element, type: string, key?: string) {
  const event =
    key === undefined
      ? new MouseEvent(type, { bubbles: true })
      : new KeyboardEvent(type, { bubbles: true, key });
  act(() => void el.dispatchEvent(event));
}

function triggerFor(host: HTMLElement, label: string): HTMLElement {
  const trigger = host.querySelector<HTMLElement>(`[role="combobox"][aria-label="${label}"]`);
  if (!trigger) throw new Error(`no select labelled ${label}`);
  return trigger;
}

/** Opens a Select and arrows down `steps` items before committing, the way a keyboard user
 * does. happy-dom does not synthesise the click Space would trigger, so it is dispatched here. */
async function chooseByArrowing(trigger: HTMLElement, steps: number) {
  fire(trigger, "keydown", " ");
  fire(trigger, "keyup", " ");
  act(() => trigger.click());
  await settle();
  for (let i = 0; i < steps; i += 1) {
    fire(document.activeElement ?? document.body, "keydown", "ArrowDown");
    await settle();
  }
  fire(document.activeElement ?? document.body, "keydown", "Enter");
  await settle();
}

function exportButtonIn(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('[data-testid="renders-export"]');
  if (!button) throw new Error("export button did not render");
  return button;
}

describe("RenderQueue controls", () => {
  it("has no native select left in the panel", () => {
    // R8. The four format / resolution / frame-rate / quality controls are the
    // shared Select now; a native one would bring back an OS popup that no
    // token can reach.
    expect(mountRenderQueue(vi.fn()).querySelector("select")).toBeNull();
  });

  it("wears exactly the header Export's recipe, plus the full width", () => {
    // AE3. Set equality, not "contains": the bug this replaces was an extra
    // `text-[11px]` on this button, which `cn` resolved by dropping the size
    // recipe's `text-step-12` and left the two Exports a type step apart.
    const shared = cn(buttonBase, buttonVariants.primary, buttonSizes.md);
    const classes = new Set(exportButtonIn(mountRenderQueue(vi.fn())).className.split(/\s+/));

    expect(classes).toEqual(new Set([...shared.split(/\s+/), "w-full"]));
  });

  it("classifies the format Select the way it classified the native one (KTD13)", async () => {
    const host = mountRenderQueue(vi.fn());
    const reference = document.createElement("select");
    document.body.append(reference);
    await settle();

    const trigger = triggerFor(host, "Format");

    // Both true, not merely equal: two falses would agree and prove nothing.
    expect(isTypingTarget(reference)).toBe(true);
    expect(shouldIgnorePlaybackShortcutTarget(reference)).toBe(true);
    expect(isTypingTarget(trigger)).toBe(isTypingTarget(reference));
    expect(shouldIgnorePlaybackShortcutTarget(trigger)).toBe(
      shouldIgnorePlaybackShortcutTarget(reference),
    );
  });

  it("submits the canonical landscape 4K preset selected by the user", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);

    // Auto, 1080p, 4K: two steps down from the default.
    await chooseByArrowing(triggerFor(host, "Resolution"), 2);
    act(() => {
      exportButtonIn(host).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "landscape-4k", 30, false);
  });

  it("refuses a resolution the composition cannot reach, and says why", async () => {
    // 1080p on a 1280x720 comp is a 1.5x scale, which the producer rejects; the
    // option stays listed (its label explains why) but the keyboard skips it.
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender, { width: 1280, height: 720 });
    const trigger = triggerFor(host, "Resolution");

    fire(trigger, "keydown", " ");
    fire(trigger, "keyup", " ");
    act(() => trigger.click());
    await settle();
    const blocked = [...document.querySelectorAll('[role="option"]')].filter((option) =>
      option.hasAttribute("data-disabled"),
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.textContent).toContain("not an integer scale of 1280×720");

    fire(document.activeElement ?? document.body, "keydown", "ArrowDown");
    await settle();
    fire(document.activeElement ?? document.body, "keydown", "Enter");
    await settle();
    fire(document.activeElement ?? document.body, "keydown", "Escape");
    await settle();
    act(() => {
      exportButtonIn(host).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, false);
  });

  it("exports with GPU encoding once the box is ticked, and remembers it", () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const gpu = [...host.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Use GPU encoding"),
    );

    act(() => gpu?.querySelector("input")?.click());
    act(() => {
      exportButtonIn(host).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, true);
    expect(getPersistedRenderSettings().gpu).toBe(true);
  });

  it("persists a changed format as the literal union value", async () => {
    const host = mountRenderQueue(vi.fn());

    // MP4, MOV, WebM: one step down commits "mov", not the label "MOV (ProRes)".
    await chooseByArrowing(triggerFor(host, "Format"), 1);

    expect(getPersistedRenderSettings()).toEqual({
      format: "mov",
      quality: "standard",
      fps: 30,
      gpu: false,
    });
    expect(host.textContent).not.toContain("Use GPU encoding");
  });
});

describe("RenderQueue Export button", () => {
  it("leaves the font size to the shared Button", () => {
    const host = mountRenderQueue(vi.fn());
    expect(exportButtonIn(host).className).not.toMatch(/text-\[/);
  });
});

describe("RenderQueue FFmpeg gate", () => {
  it("refuses Export and shows the install command when the server reports no FFmpeg", () => {
    ffmpegStatus = {
      ok: false,
      title: "FFmpeg not found",
      detail: "FFmpeg is required to encode video.",
      hint: "brew install ffmpeg",
      command: "brew install ffmpeg",
    };
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);

    expect(host.textContent).toContain("FFmpeg not found");
    expect(host.querySelector("code")?.textContent).toBe("brew install ffmpeg");

    const exportButton = exportButtonIn(host);
    expect(exportButton.disabled).toBe(true);
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onStartRender).not.toHaveBeenCalled();
  });

  it("offers a recheck so installing FFmpeg does not require restarting Studio", () => {
    ffmpegStatus = { ok: false, title: "FFmpeg not found", command: "brew install ffmpeg" };
    const host = mountRenderQueue(vi.fn());

    const recheckButton = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Recheck",
    );
    if (!recheckButton) throw new Error("recheck button did not render");
    act(() => {
      recheckButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(recheck).toHaveBeenCalledTimes(1);
  });

  // An unreachable or older dev server answers nothing. Treating "no answer"
  // as "not installed" would lock Export for setups that render fine.
  it("leaves Export usable when the probe returns no answer", () => {
    ffmpegStatus = null;
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);

    expect(host.textContent).not.toContain("FFmpeg not found");
    const exportButton = exportButtonIn(host);
    expect(exportButton.disabled).toBe(false);
    act(() => {
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onStartRender).toHaveBeenCalledTimes(1);
  });

  it("says nothing when FFmpeg is present", () => {
    const host = mountRenderQueue(vi.fn());

    expect(host.textContent).not.toContain("FFmpeg not found");
    expect(exportButtonIn(host).disabled).toBe(false);
  });
});

function advancedButtonIn(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "Advanced",
  );
  if (!button) throw new Error("Advanced disclosure did not render");
  return button;
}

function expandAdvanced(host: HTMLElement) {
  act(() => advancedButtonIn(host).click());
}

async function chooseOption(host: HTMLElement, label: string, text: string) {
  const trigger = triggerFor(host, label);
  act(() => trigger.click());
  await settle();
  const popup = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!popup) throw new Error(`no popup for ${label}`);
  const option = [...popup.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === text,
  );
  if (!option) throw new Error(`no ${label} option ${text}`);
  act(() => option.click());
  await settle();
}

function editInput(host: HTMLElement, label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`no input ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("input value setter missing");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

function savedSettings(): unknown {
  return JSON.parse(localStorage.getItem("hf-studio-render-settings") ?? "{}");
}

async function mountWithCrf(onStartRender: Mock<StartRenderHandler> = vi.fn(), value = "18") {
  const host = mountRenderQueue(onStartRender);
  expandAdvanced(host);
  await chooseOption(host, "Rate control", "CRF");
  editInput(host, "CRF", value);
  return host;
}

async function chooseFramesAndHdr(host: HTMLElement, frames = "PNG", hdr = "Force off") {
  await chooseOption(host, "Source video frames", frames);
  await chooseOption(host, "HDR", hdr);
}

const autoAdvanced = {
  rateControl: { mode: "auto" },
  videoFrameFormat: "auto",
  hdrMode: "auto",
};

describe("RenderQueue advanced export settings", () => {
  it("starts collapsed and links its disclosure to the controls", () => {
    const host = mountRenderQueue(vi.fn());
    const advanced = advancedButtonIn(host);
    expect(advanced.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[aria-label="Rate control"]')).toBeNull();
    expandAdvanced(host);
    expect(advanced.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(advanced.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(triggerFor(host, "Rate control")).not.toBeNull();
    expandAdvanced(host);
    expect(host.querySelector('[aria-label="Rate control"]')).toBeNull();
  });

  it.each([0, 51])(
    "preserves MP4 CRF %s and passes advanced settings after the GIF loop argument",
    async (crf) => {
      const onStartRender: Mock<StartRenderHandler> = vi.fn();
      const host = mountRenderQueue(onStartRender);
      expandAdvanced(host);
      await chooseOption(host, "Rate control", "CRF");
      const input = editInput(host, "CRF", String(crf));
      expect(input.min).toBe("0");
      expect(input.max).toBe("51");
      expect(input.step).toBe("1");
      act(() => exportButtonIn(host).click());
      expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, false, undefined, {
        ...autoAdvanced,
        rateControl: { mode: "crf", value: crf },
      });
    },
  );

  it.each(["-1", "52", "18.5"])(
    "blocks invalid CRF %s without replacing the saved valid value",
    async (draft) => {
      const onStartRender: Mock<StartRenderHandler> = vi.fn();
      const host = mountRenderQueue(onStartRender);
      expandAdvanced(host);
      await chooseOption(host, "Rate control", "CRF");
      editInput(host, "CRF", "18");
      const saved = savedSettings();
      const input = editInput(host, "CRF", draft);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const error = document.getElementById(input.getAttribute("aria-errormessage") ?? "");
      expect(error?.textContent).toMatch(/CRF|integer/i);
      expect(exportButtonIn(host).disabled).toBe(true);
      act(() => exportButtonIn(host).click());
      expect(onStartRender).not.toHaveBeenCalled();
      expect(savedSettings()).toEqual(saved);
    },
  );

  it.each([
    ["CRF", "52", "18"],
    ["Target bitrate", "10MB", "1.5M"],
  ])(
    "keeps invalid %s feedback visible when Advanced is collapsed",
    async (label, invalid, valid) => {
      const onStartRender: Mock<StartRenderHandler> = vi.fn();
      const host = mountRenderQueue(onStartRender);
      expandAdvanced(host);
      await chooseOption(host, "Rate control", label);
      editInput(host, label, invalid);
      const message = host.querySelector('[role="alert"]')?.textContent;
      expect(message).toBeTruthy();
      expandAdvanced(host);
      expect(host.querySelector(`[aria-label="${label}"]`)).toBeNull();
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
      expect(exportButtonIn(host).disabled).toBe(true);
      act(() => exportButtonIn(host).click());
      expect(onStartRender).not.toHaveBeenCalled();
      expandAdvanced(host);
      expect(host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value).toBe(invalid);
      editInput(host, label, valid);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(exportButtonIn(host).disabled).toBe(false);
    },
  );

  it("clears a CRF override on blank and keeps the legacy default callback", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    expandAdvanced(host);
    await chooseOption(host, "Rate control", "CRF");
    editInput(host, "CRF", "0");
    editInput(host, "CRF", "");
    expect(exportButtonIn(host).disabled).toBe(false);
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, false);
    expect(savedSettings()).not.toHaveProperty("rateControl");
  });

  it("switches rate modes atomically, trims bitrate, and rejects invalid bitrate", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = await mountWithCrf(onStartRender);
    await chooseOption(host, "Rate control", "Target bitrate");
    expect(host.querySelector('[aria-label="CRF"]')).toBeNull();
    expect(savedSettings()).not.toHaveProperty("rateControl");
    editInput(host, "Target bitrate", " 1.5M ");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenLastCalledWith(
      "mp4",
      "standard",
      "auto",
      30,
      false,
      undefined,
      {
        ...autoAdvanced,
        rateControl: { mode: "bitrate", value: "1.5M" },
      },
    );
    const saved = savedSettings();
    editInput(host, "Target bitrate", "10MB");
    expect(exportButtonIn(host).disabled).toBe(true);
    expect(savedSettings()).toEqual(saved);
    editInput(host, "Target bitrate", "");
    expect(exportButtonIn(host).disabled).toBe(false);
    expect(savedSettings()).not.toHaveProperty("rateControl");
  });

  it("accepts WebM CRF63 and resets it with an explanation when switching to MP4", async () => {
    const host = mountRenderQueue(vi.fn());
    await chooseOption(host, "Format", "WebM");
    expandAdvanced(host);
    await chooseOption(host, "Rate control", "CRF");
    expect(editInput(host, "CRF", "63").max).toBe("63");
    expect(savedSettings()).toHaveProperty("rateControl", { mode: "crf", value: 63 });
    await chooseOption(host, "Format", "MP4");
    expect(triggerFor(host, "Rate control").textContent).toContain("Quality preset");
    expect(host.textContent).toContain("cleared");
    expect(savedSettings()).not.toHaveProperty("rateControl");
  });

  it("preserves valid advanced settings when basic settings change", async () => {
    const host = await mountWithCrf();
    await chooseFramesAndHdr(host);
    await chooseOption(host, "Format", "WebM");
    await chooseOption(host, "Frame rate", "60 fps");
    await chooseOption(host, "Quality", "High Quality");
    expect(savedSettings()).toMatchObject({
      format: "webm",
      quality: "high",
      fps: 60,
      rateControl: { mode: "crf", value: 18 },
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
    });
  });

  it("clears and disables MOV rate controls while retaining frame and HDR choices", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = await mountWithCrf(onStartRender);
    await chooseFramesAndHdr(host, "JPG", "Force on");
    await chooseOption(host, "Format", "MOV (ProRes)");
    expect(triggerFor(host, "Rate control").hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain("ProRes");
    expect(host.textContent).toContain("SDR");
    expect(host.textContent).toContain("native HDR");
    expect(host.textContent).toContain("source video");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenLastCalledWith(
      "mov",
      "standard",
      "auto",
      30,
      false,
      undefined,
      {
        rateControl: { mode: "auto" },
        videoFrameFormat: "jpg",
        hdrMode: "force-hdr",
      },
    );
    await chooseOption(host, "Format", "MP4");
    expect(triggerFor(host, "Rate control").textContent).toContain("Quality preset");
    expect(savedSettings()).not.toHaveProperty("rateControl");
  });

  it("removes all advanced overrides when the user returns each selector to Auto", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = await mountWithCrf(onStartRender);
    await chooseFramesAndHdr(host);
    await chooseOption(host, "Rate control", "Quality preset");
    await chooseOption(host, "Source video frames", "Auto");
    await chooseOption(host, "HDR", "Auto");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledWith("mp4", "standard", "auto", 30, false);
    expect(savedSettings()).toEqual({ format: "mp4", quality: "standard", fps: 30, gpu: false });
  });

  it("restores valid stored overrides but always mounts Advanced collapsed", () => {
    localStorage.setItem(
      "hf-studio-render-settings",
      JSON.stringify({
        format: "webm",
        quality: "high",
        fps: 60,
        gpu: true,
        rateControl: { mode: "crf", value: 63 },
        videoFrameFormat: "png",
        hdrMode: "force-sdr",
      }),
    );
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    expect(advancedButtonIn(host).getAttribute("aria-expanded")).toBe("false");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledWith("webm", "high", "auto", 60, true, undefined, {
      rateControl: { mode: "crf", value: 63 },
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
    });
  });

  it("disables advanced editing and export while rendering", () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    localStorage.setItem(
      "hf-studio-render-settings",
      JSON.stringify({
        format: "mp4",
        quality: "standard",
        fps: 30,
        gpu: false,
        rateControl: { mode: "crf", value: 18 },
      }),
    );
    const host = mountRenderQueue(onStartRender, undefined, true);
    expandAdvanced(host);
    expect(host.querySelector<HTMLInputElement>('[aria-label="CRF"]')?.disabled).toBe(true);
    for (const label of ["Rate control", "Source video frames", "HDR"]) {
      expect(triggerFor(host, label).hasAttribute("disabled")).toBe(true);
    }
    expect(exportButtonIn(host).disabled).toBe(true);
    act(() => exportButtonIn(host).click());
    expect(onStartRender).not.toHaveBeenCalled();
  });
});

function mountGifQueue() {
  localStorage.setItem("hf-studio-render-settings", JSON.stringify({ format: "gif" }));
  const onStartRender: Mock<StartRenderHandler> = vi.fn();
  return { onStartRender, host: mountRenderQueue(onStartRender) };
}

function enterGifLoop(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="number"]');
  if (!input) throw new Error("missing loop count");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

describe("GIF export controls", () => {
  it("offers GIF, persists the selection, and exports with infinite looping", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    await chooseByArrowing(triggerFor(host, "Format"), 3);
    expect(getPersistedRenderSettings().format).toBe("gif");
    const input = host.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input?.value).toBe("0");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledWith("gif", "standard", "auto", 30, false, 0);
  });

  it("restores GIF settings and exports a finite loop count", () => {
    const { host, onStartRender } = mountGifQueue();
    enterGifLoop(host, "3");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledWith("gif", "standard", "auto", 30, false, 3);
  });

  it.each(["", "-1", "1.5", "65536"])("blocks export for invalid GIF loop count %j", (value) => {
    const { host, onStartRender } = mountGifQueue();
    const input = enterGifLoop(host, value);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(exportButtonIn(host).disabled).toBe(true);
    act(() => exportButtonIn(host).click());
    expect(onStartRender).not.toHaveBeenCalled();
  });
});

describe("GIF frame-rate controls", () => {
  it("caps a saved GIF frame rate of 60 and disables that option", async () => {
    localStorage.setItem("hf-studio-render-settings", JSON.stringify({ format: "gif", fps: 60 }));
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    const fps = triggerFor(host, "Frame rate");
    expect(fps.textContent).toContain("30 fps");
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledWith("gif", "standard", "auto", 30, false, 0);
    act(() => fps.click());
    await settle();
    const sixty = Array.from(document.querySelectorAll('[role="option"]')).find((option) =>
      option.textContent?.includes("60 fps"),
    );
    expect(sixty?.getAttribute("aria-disabled")).toBe("true");
  });

  it("switches a 60 fps video to a 30 fps GIF and preserves 60 fps for video", async () => {
    localStorage.setItem("hf-studio-render-settings", JSON.stringify({ format: "mp4", fps: 60 }));
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenLastCalledWith("mp4", "standard", "auto", 60, false);
    await chooseByArrowing(triggerFor(host, "Format"), 3);
    expect(triggerFor(host, "Frame rate").textContent).toContain("30 fps");
    expect(getPersistedRenderSettings()).toMatchObject({ format: "gif", fps: 30 });
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenLastCalledWith("gif", "standard", "auto", 30, false, 0);
  });
});

describe("GIF and advanced export integration", () => {
  it("hides advanced controls and exports GIF without the video's saved advanced overrides", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = await mountWithCrf(onStartRender);
    await chooseFramesAndHdr(host, "PNG", "Force on");
    await chooseOption(host, "Format", "GIF");
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "Advanced"),
    ).toBe(false);
    expect(host.querySelector('[aria-label="Rate control"]')).toBeNull();
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledExactlyOnceWith("gif", "standard", "auto", 30, false, 0);
  });

  it("discards an invalid video draft when switching to GIF", async () => {
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = await mountWithCrf(onStartRender);
    editInput(host, "CRF", "52");
    expect(exportButtonIn(host).disabled).toBe(true);
    await chooseOption(host, "Format", "GIF");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(exportButtonIn(host).disabled).toBe(false);
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledExactlyOnceWith("gif", "standard", "auto", 30, false, 0);
  });

  it("restores the video's requested 60 fps after returning from GIF", async () => {
    localStorage.setItem("hf-studio-render-settings", JSON.stringify({ format: "mp4", fps: 60 }));
    const onStartRender: Mock<StartRenderHandler> = vi.fn();
    const host = mountRenderQueue(onStartRender);
    await chooseOption(host, "Format", "GIF");
    expect(triggerFor(host, "Frame rate").textContent).toContain("30 fps");
    await chooseOption(host, "Format", "MP4");
    expect(triggerFor(host, "Frame rate").textContent).toContain("60 fps");
    expect(getPersistedRenderSettings()).toMatchObject({ format: "mp4", fps: 60 });
    act(() => exportButtonIn(host).click());
    expect(onStartRender).toHaveBeenCalledExactlyOnceWith("mp4", "standard", "auto", 60, false);
  });
});
