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
