// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultAudioFxParams,
  getAudioFxDef,
  HF_AUDIO_FX,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import { DEFAULT_CARVE } from "@hyperframes/core/audio-carve";
import { createRoot } from "react-dom/client";
import { FxSection } from "./propertyPanelFxSection.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

const chainOf = (...types: string[]): HfAudioFxChain => ({
  version: 1,
  nodes: types.map((t) => ({ type: t, enabled: true, params: defaultAudioFxParams(t) })),
});

const noop = () => {};

function mount(overrides: Partial<Parameters<typeof FxSection>[0]> = {}) {
  const onChainChange = vi.fn();
  const onChainPreview = vi.fn();
  const onCarveChange = vi.fn();
  const { host } = renderInto(
    <FxSection
      chain={overrides.chain ?? { version: 1, nodes: [] }}
      onChainChange={overrides.onChainChange ?? onChainChange}
      onChainPreview={overrides.onChainPreview ?? onChainPreview}
      carve={overrides.carve ?? null}
      onCarveChange={overrides.onCarveChange ?? onCarveChange}
      sourceOptions={overrides.sourceOptions ?? [{ id: "vo", label: "Voiceover" }]}
      onAnalyseCarve={overrides.onAnalyseCarve ?? noop}
      analysing={overrides.analysing}
      disabled={overrides.disabled}
      automatedTargets={overrides.automatedTargets}
      onAutomateParam={overrides.onAutomateParam}
      onRemoveParamAutomation={overrides.onRemoveParamAutomation}
    />,
  );
  return { host, onChainChange, onChainPreview, onCarveChange };
}

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => {
    (el as HTMLElement).click();
  });
};
const byText = (host: HTMLElement, sel: string, text: string) =>
  Array.from(host.querySelectorAll(sel)).find((e) => e.textContent?.trim() === text);

/**
 * React tracks an input's value on the DOM node, so assigning `.value` and
 * dispatching looks like a no-op change and the handler never fires. Going
 * through the native setter clears that tracker.
 */
const typeInto = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("FxSection chain", () => {
  it("says so when the track has no effects", () => {
    const { host } = mount();
    expect(host.querySelector(".hf-fx-empty")?.textContent).toMatch(/No effects/);
  });

  it("offers every effect in the registry, grouped", () => {
    // The add menu is generated, so a new effect upstream appears here with no
    // change to the panel.
    const { host } = mount();
    click(host.querySelector(".hf-fx-add"));
    const items = Array.from(host.querySelectorAll(".hf-fx-add-item")).map((e) =>
      e.textContent?.trim(),
    );
    expect(items).toHaveLength(HF_AUDIO_FX.length);
    for (const def of HF_AUDIO_FX) expect(items).toContain(def.label);
  });

  it("adds an effect seeded with its declared defaults", () => {
    const { host, onChainChange } = mount();
    click(host.querySelector(".hf-fx-add"));
    click(byText(host, ".hf-fx-add-item", "Compressor"));
    expect(onChainChange).toHaveBeenCalledTimes(1);
    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]!.type).toBe("compressor");
    expect(next.nodes[0]!.params).toEqual(defaultAudioFxParams("compressor"));
  });

  it("renders a control for every parameter the effect declares", () => {
    const { host } = mount({ chain: chainOf("compressor") });
    const def = getAudioFxDef("compressor")!;
    const labels = Array.from(host.querySelectorAll(".hf-fx-label")).map((e) =>
      e.textContent?.trim(),
    );
    for (const p of def.params) expect(labels).toContain(p.label);
  });

  it("uses a select for an enum parameter and a slider for a number", () => {
    const { host } = mount({ chain: chainOf("saturate") });
    expect(host.querySelector(".hf-fx-select")).toBeTruthy();
    expect(host.querySelector(".hf-fx-slider")).toBeTruthy();
  });

  it("bypasses without removing, so the settings survive", () => {
    const { host, onChainChange } = mount({ chain: chainOf("peaking") });
    click(host.querySelector(".hf-fx-bypass"));
    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]!.enabled).toBe(false);
    expect(next.nodes[0]!.params).toEqual(defaultAudioFxParams("peaking"));
  });

  it("reorders, because chain order changes the sound", () => {
    const { host, onChainChange } = mount({ chain: chainOf("peaking", "reverb") });
    const downs = Array.from(host.querySelectorAll('.hf-fx-move[title="Move down"]'));
    click(downs[0]);
    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes.map((n) => n.type)).toEqual(["reverb", "peaking"]);
  });

  it("cannot move the ends past themselves", () => {
    const { host } = mount({ chain: chainOf("peaking", "reverb") });
    const ups = host.querySelectorAll('.hf-fx-move[title="Move up"]');
    const downs = host.querySelectorAll('.hf-fx-move[title="Move down"]');
    expect((ups[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downs[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes an effect", () => {
    const { host, onChainChange } = mount({ chain: chainOf("peaking", "reverb") });
    click(host.querySelector(".hf-fx-remove"));
    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes.map((n) => n.type)).toEqual(["reverb"]);
  });

  it("previews while dragging and only persists on release", () => {
    // Persisting on every input event refreshes the preview, which reloads the
    // composition and restarts audio — that is what made playback stutter.
    const { host, onChainChange, onChainPreview } = mount({ chain: chainOf("peaking") });
    const slider = host.querySelector<HTMLInputElement>(".hf-fx-slider")!;
    act(() => slider.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    for (const v of ["5000", "10000", "15000"]) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      act(() => {
        setter?.call(slider, v);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(onChainPreview.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onChainChange).not.toHaveBeenCalled();

    act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
    expect(onChainChange).toHaveBeenCalledTimes(1);
  });

  it("commits an enum immediately, since a select has no drag", () => {
    const { host, onChainChange } = mount({ chain: chainOf("saturate") });
    const select = host.querySelector<HTMLSelectElement>(".hf-fx-select")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter?.call(select, "atan");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChainChange).toHaveBeenCalledTimes(1);
  });

  it("clamps a typed value into the renderable range", () => {
    const { host, onChainChange } = mount({ chain: chainOf("peaking") });
    const input = host.querySelector<HTMLInputElement>(".hf-fx-number")!;
    typeInto(input, "999999");
    // React delegates onBlur through focusout, which is the event that bubbles.
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    const next = onChainChange.mock.calls.at(-1)![0] as HfAudioFxChain;
    expect(next.nodes[0]!.params!.frequency).toBe(20000);
  });
});

describe("FxSection carve", () => {
  it("is off by default and is not an entry in the chain", () => {
    const { host } = mount();
    expect(host.querySelector(".hf-fx-carve")).toBeTruthy();
    click(host.querySelector(".hf-fx-add"));
    const items = Array.from(host.querySelectorAll(".hf-fx-add-item")).map((e) =>
      e.textContent?.trim(),
    );
    expect(items).not.toContain("Voiceover carve");
  });

  it("turns on with defaults", () => {
    const { host, onCarveChange } = mount();
    click(host.querySelector(".hf-fx-carve .hf-fx-bypass"));
    expect(onCarveChange).toHaveBeenCalledWith({ ...DEFAULT_CARVE });
  });

  it("lists the other audio tracks as carve sources", () => {
    const { host } = mount({
      carve: { ...DEFAULT_CARVE },
      sourceOptions: [
        { id: "vo", label: "Voiceover" },
        { id: "nar", label: "Narration" },
      ],
    });
    const options = Array.from(host.querySelectorAll(".hf-fx-carve select option")).map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toContain("Voiceover");
    expect(options).toContain("Narration");
  });

  it("will not analyse until a source is chosen", () => {
    const { host } = mount({ carve: { ...DEFAULT_CARVE, source: "" } });
    expect(host.querySelector<HTMLButtonElement>(".hf-fx-analyse")!.disabled).toBe(true);
  });

  it("analyses once a source is chosen", () => {
    const onAnalyseCarve = vi.fn();
    const { host } = mount({ carve: { ...DEFAULT_CARVE, source: "vo" }, onAnalyseCarve });
    click(host.querySelector(".hf-fx-analyse"));
    expect(onAnalyseCarve).toHaveBeenCalledTimes(1);
  });

  it("disables everything when the panel is read-only", () => {
    const { host } = mount({ chain: chainOf("peaking"), disabled: true });
    for (const b of Array.from(host.querySelectorAll("button.hf-fx-bypass, .hf-fx-remove"))) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("automation in the panel", () => {
  const automatable = (chain: HfAudioFxChain, over = {}) =>
    mount({
      chain,
      automatedTargets: new Set<string>(),
      onAutomateParam: vi.fn(),
      onRemoveParamAutomation: vi.fn(),
      ...over,
    });

  const idChain = (type: string, id = "n1"): HfAudioFxChain => ({
    version: 1,
    nodes: [{ type, id, enabled: true, params: defaultAudioFxParams(type) }],
  });

  const rowFor = (host: HTMLElement, label: string): HTMLElement | null => {
    for (const row of Array.from(host.querySelectorAll<HTMLElement>(".hf-fx-row"))) {
      if (row.querySelector(".hf-fx-label")?.textContent === label) return row;
    }
    return null;
  };

  it("offers an automate button only for parameters an envelope can drive", () => {
    // Saturate: `output` is a make-up gain, but the curve's type and threshold
    // are rebuilt wholesale and cannot be scheduled.
    const { host } = automatable(idChain("saturate"));
    expect(rowFor(host, "Output")?.querySelector(".hf-fx-automate")).toBeTruthy();
    expect(rowFor(host, "Threshold")?.querySelector(".hf-fx-automate")).toBeNull();
  });

  it("offers nothing for a worklet effect, which exposes no AudioParams", () => {
    const { host } = automatable(idChain("compressor"));
    expect(host.querySelectorAll(".hf-fx-automate").length).toBe(0);
  });

  it("asks to automate a parameter by node id and key", () => {
    const onAutomateParam = vi.fn();
    const { host } = automatable(idChain("lowpass", "n7"), { onAutomateParam });
    const button = rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement;
    expect(button.hasAttribute("title")).toBe(false);
    act(() => button.click());
    expect(onAutomateParam).toHaveBeenCalledWith("n7", "frequency");
  });

  it("disables an automated control, since a value typed here would be overwritten", () => {
    const { host } = automatable(idChain("lowpass"), {
      automatedTargets: new Set(["fx.n1.frequency"]),
    });
    const row = rowFor(host, "Cutoff")!;
    expect(row.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    expect(row.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true);
    expect(row.hasAttribute("data-automated")).toBe(true);
    // A sibling parameter on the same effect stays editable.
    const q = rowFor(host, "Q")!;
    expect(q.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(false);
  });

  it("turns the automated parameter's button into a delete", () => {
    const onRemoveParamAutomation = vi.fn();
    const { host } = automatable(idChain("lowpass"), {
      automatedTargets: new Set(["fx.n1.frequency"]),
      onRemoveParamAutomation,
    });
    const button = rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toMatch(/remove/i);
    // The wording lives in the Tooltip component, which only renders its bubble
    // on hover; the button itself carries no native title hover.
    expect(button.hasAttribute("title")).toBe(false);
    act(() => button.click());
    expect(onRemoveParamAutomation).toHaveBeenCalledWith("n1", "frequency");
  });

  it("shows the wording in a tooltip bubble, not a native browser hover", async () => {
    vi.useFakeTimers();
    try {
      const { host } = automatable(idChain("lowpass"), {
        automatedTargets: new Set(["fx.n1.frequency"]),
      });
      const button = rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement;
      // Tooltip positions itself from the trigger's box and gives up on a 0x0
      // one, which is every element in happy-dom.
      vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
        x: 100,
        y: 300,
        left: 100,
        top: 300,
        right: 116,
        bottom: 316,
        width: 16,
        height: 16,
        toJSON: () => ({}),
      } as DOMRect);
      // React synthesises pointer-enter from pointerover and delegates focus via
      // focusin; focus is also how a keyboard user reaches the same tooltip.
      act(() => {
        button.dispatchEvent(new Event("focusin", { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      const bubble = document.querySelector('[role="tooltip"]');
      expect(bubble?.textContent).toBe("Automated");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot automate a node with no id, which a lane could not address", () => {
    const { host } = automatable({
      version: 1,
      nodes: [{ type: "lowpass", enabled: true, params: defaultAudioFxParams("lowpass") }],
    });
    expect(host.querySelectorAll(".hf-fx-automate").length).toBe(0);
  });

  it("gives a newly added effect an id, so its parameters can be automated", () => {
    const onChainChange = vi.fn();
    const { host } = mount({ chain: { version: 1, nodes: [] }, onChainChange });
    const add = host.querySelector(".hf-fx-add") as HTMLButtonElement;
    act(() => add.click());
    const item = Array.from(host.querySelectorAll<HTMLButtonElement>(".hf-fx-add-item")).find(
      (b) => b.textContent === "Low-pass",
    )!;
    act(() => item.click());
    expect(onChainChange.mock.calls[0][0].nodes[0].id).toBe("n1");
  });
});
