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
import { EFFECT_COPY, PRESET_PROBLEM } from "@hyperframes/core/audio-fx-copy";
import { HF_AUDIO_FX_JOBS, HF_AUDIO_FX_JOB_TYPES } from "@hyperframes/core/audio-fx-jobs";
import { getAudioFxPreset } from "@hyperframes/core/audio-fx-presets";

/**
 * What a knob is CALLED in the panel, looked up rather than spelled out.
 *
 * The rack speaks the plain-language layer now, so a row is addressed by the
 * parameter it belongs to and the copy decides the words. Hard-coding them here
 * would make every copy edit a test edit, and these tests are about which row
 * carries the automate button — not about how it reads.
 */
function plainLabel(effectId: string, key: string): string {
  const label = EFFECT_COPY[effectId]?.params[key]?.label;
  if (!label) throw new Error(`no copy for ${effectId}.${key}`);
  return label;
}
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

/** A carve's own filters and level stage, plus one effect the author added. */
const carved = {
  version: 1,
  nodes: [
    { type: "peaking", id: "n1", fromCarve: true, params: { frequency: 400, gain: -6, q: 1.4 } },
    { type: "peaking", id: "n2", fromCarve: true, params: { frequency: 1600, gain: -9, q: 1.4 } },
    { type: "gain", id: "n3", fromCarve: true, params: { gain: -6 } },
    { type: "lowpass", id: "n4", params: { frequency: 8000, q: 0.7, poles: "2" } },
  ],
} as unknown as HfAudioFxChain;

/** The first effect the author added, skipping the carve module that leads the rack. */
function fxCard(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>(".hf-fx-node:not(.hf-fx-carve-module)")!;
}

/** Open the carve module if something closed it — it starts open. */
function ensureCarveOpen(host: HTMLElement): HTMLElement {
  const module = host.querySelector<HTMLElement>(".hf-fx-carve-module")!;
  const head = module.querySelector<HTMLButtonElement>(".hf-fx-node-name")!;
  if (head.getAttribute("aria-expanded") === "false") act(() => head.click());
  return module;
}

function mount(overrides: Partial<Parameters<typeof FxSection>[0]> = {}) {
  const onChainChange = vi.fn();
  const onChainPreview = vi.fn();
  const onCarveChange = vi.fn();
  const { host, root } = renderInto(
    <FxSection
      chain={overrides.chain ?? { version: 1, nodes: [] }}
      onChainChange={overrides.onChainChange ?? onChainChange}
      onChainPreview={overrides.onChainPreview ?? onChainPreview}
      carve={overrides.carve ?? null}
      onCarveChange={overrides.onCarveChange ?? onCarveChange}
      sourceOptions={overrides.sourceOptions ?? [{ id: "vo", label: "Voiceover" }]}
      analysing={overrides.analysing}
      disabled={overrides.disabled}
      automatedTargets={overrides.automatedTargets}
      onAutomateParam={overrides.onAutomateParam}
      onRemoveParamAutomation={overrides.onRemoveParamAutomation}
      onLevel={overrides.onLevel}
      onRemoveLevel={overrides.onRemoveLevel}
      levelled={overrides.levelled}
      onAuditionLevel={overrides.onAuditionLevel}
      auditioningLevel={overrides.auditioningLevel}
    />,
  );
  return { host, root, onChainChange, onChainPreview, onCarveChange };
}

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => {
    (el as HTMLElement).click();
  });
};
const byText = (host: HTMLElement, sel: string, text: string) =>
  Array.from(host.querySelectorAll(sel)).find((e) => e.textContent?.trim() === text);

const openAddMenuItems = (host: HTMLElement) => {
  click(host.querySelector(".hf-fx-add"));
  return Array.from(host.querySelectorAll(".hf-fx-add-item")).map((e) => e.textContent?.trim());
};

/**
 * A preset button, found by the preset it applies rather than by its words.
 *
 * The shelf leads with the complaint and follows with the name, so a button's
 * text is two sentences and neither of them alone is what an author would call
 * it. Addressing it by id keeps the test about what applying it does.
 */
const presetButton = (host: HTMLElement, id: string): Element | undefined =>
  Array.from(host.querySelectorAll(".hf-fx-preset-item")).find(
    (e) =>
      e.querySelector(".hf-fx-preset-name")?.textContent?.trim() === getAudioFxPreset(id)?.label,
  );

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
    // "other", because the carve module is in the rack whenever a voice exists.
    expect(host.querySelector(".hf-fx-empty")?.textContent).toMatch(/No other effects/);
  });

  it("offers every effect in the registry, grouped", () => {
    // The add menu is generated, so a new effect upstream appears here with no
    // change to the panel.
    const { host } = mount();
    const items = openAddMenuItems(host);
    // Every effect is reachable, but not every one under its own name: the jobs
    // stand in for the effect they are made of, because picking `peaking` is
    // picking a machine and leaving the real decision for afterwards.
    const standIns = HF_AUDIO_FX.filter((d) => HF_AUDIO_FX_JOB_TYPES.has(d.id));
    expect(items).toHaveLength(HF_AUDIO_FX.length - standIns.length + HF_AUDIO_FX_JOBS.length);
    for (const def of HF_AUDIO_FX) {
      if (HF_AUDIO_FX_JOB_TYPES.has(def.id)) {
        // Not offered as itself, and it must not be — two doors to the same
        // effect, one of them the incoherent one, is worse than either alone.
        expect(items).not.toContain(EFFECT_COPY[def.id]?.title);
        continue;
      }
      // By the name the RACK will use, not the registry's — picking "High-pass"
      // and getting a module called "Remove Rumble" is the inconsistency this
      // whole layer exists to remove.
      expect(items).toContain(EFFECT_COPY[def.id]?.title);
    }
    for (const job of HF_AUDIO_FX_JOBS) expect(items).toContain(job.label);
  });

  it("adds a job as an ordinary effect, already named and already aimed", () => {
    // The range IS the module: one knob is honest here because the decision the
    // knob depends on has already been made.
    const { host, onChainChange } = mount({ chain: { version: 1, nodes: [] } });
    click(host.querySelector(".hf-fx-add"));
    click(byText(host, ".hf-fx-add-item", "Reduce Mud"));

    const next = onChainChange.mock.calls[0]?.[0] as HfAudioFxChain;
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]?.type).toBe("peaking");
    expect(next.nodes[0]?.label).toBe("Reduce Mud");
    expect(next.nodes[0]?.params?.frequency).toBe(250);
  });

  it("shows two jobs over the same effect as the different things they are", () => {
    // The whole point. Read down the rack, "Shape One Range" twice was two rows
    // an author could not tell apart — and one of them was cutting while the
    // other was boosting.
    const { host } = mount({
      chain: {
        version: 1,
        nodes: [
          { type: "peaking", label: "Reduce Mud", params: { frequency: 250, gain: -3, q: 1.2 } },
          { type: "peaking", label: "Add Clarity", params: { frequency: 3000, gain: 2.5, q: 1 } },
        ],
      } as unknown as HfAudioFxChain,
    });
    const names = Array.from(host.querySelectorAll(".hf-fx-node-name")).map((e) =>
      e.textContent?.trim(),
    );
    expect(names).toContain("Reduce Mud");
    expect(names).toContain("Add Clarity");
    expect(names).not.toContain(EFFECT_COPY.peaking?.title);
  });

  it("adds an effect seeded with its declared defaults", () => {
    const { host, onChainChange } = mount();
    click(host.querySelector(".hf-fx-add"));
    click(byText(host, ".hf-fx-add-item", EFFECT_COPY.compressor?.title ?? ""));
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
    for (const p of def.params) expect(labels).toContain(plainLabel("compressor", p.key));
  });

  it("uses a select for an enum parameter and a slider for a number", () => {
    const { host } = mount({ chain: chainOf("saturate") });
    expect(host.querySelector(".hf-fx-select")).toBeTruthy();
    expect(host.querySelector(".hf-fx-slider")).toBeTruthy();
  });

  it("bypasses without removing, so the settings survive", () => {
    const { host, onChainChange } = mount({ chain: chainOf("peaking") });
    click(fxCard(host).querySelector(".hf-fx-bypass"));
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

  it("keeps a half-typed value with its own effect across a reorder", () => {
    // Rows used to be keyed `${type}-${index}`, so two effects of the same type
    // kept their keys through a reorder and React reused each row where it
    // stood. The controls hold real state — a number field mid-edit is held as
    // text — so the buffer stayed at the position and landed on whichever
    // effect moved into it.
    const peaking = (id: string, frequency: number) => ({
      type: "peaking",
      id,
      enabled: true,
      params: { ...defaultAudioFxParams("peaking"), frequency },
    });
    const a = peaking("pa", 400);
    const b = peaking("pb", 1600);
    const chainOfNodes = (...nodes: unknown[]): HfAudioFxChain =>
      ({ version: 1, nodes }) as HfAudioFxChain;

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (chain: HfAudioFxChain) =>
      act(() => {
        root.render(
          <FxSection
            chain={chain}
            onChainChange={vi.fn()}
            onChainPreview={vi.fn()}
            carve={null}
            onCarveChange={vi.fn()}
            sourceOptions={[]}
          />,
        );
      });

    render(chainOfNodes(a, b));
    // Only the first card is open, which is the one being edited.
    const openFrequency = (): HTMLInputElement =>
      host.querySelector<HTMLInputElement>(".hf-fx-node .hf-fx-number")!;

    expect(openFrequency().value).toBe("400");
    typeInto(openFrequency(), "123");
    expect(openFrequency().value).toBe("123");

    // The author moves that effect down; the other one takes the open slot.
    render(chainOfNodes(b, a));

    expect(openFrequency().value).toBe("1600");
  });

  it("applies a preset as ordinary nodes, tagged with where they came from", () => {
    const { host, onChainChange } = mount({ chain: { version: 1, nodes: [] } });
    click(byText(host, "button", "Presets"));
    click(presetButton(host, "telephone"));

    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    // The band, its honk and de-mud shaping, and the soft clip — a chain the
    // author can now see and edit, not an opaque "telephone" setting.
    expect(next.nodes.map((n) => n.type)).toEqual([
      "highpass",
      "highpass",
      "lowpass",
      "lowpass",
      "peaking",
      "peaking",
      "saturate",
    ]);
    expect(next.nodes.every((n) => n.fromPreset === "telephone")).toBe(true);
    // Every node needs an id or its parameters can never be automated.
    expect(new Set(next.nodes.map((n) => n.id)).size).toBe(next.nodes.length);
  });

  it("names an effect for the job it does, and keeps the DSP name for inside", () => {
    // The rack is read by somebody who has never opened a mixer. "Remove Rumble"
    // is what they came here for; "High-pass" is a fact about the mechanism, so
    // it waits until they open the module and ask.
    const { host } = mount({ chain: chainOf("highpass") });
    const node = fxCard(host);
    const name = node.querySelector(".hf-fx-node-name")?.textContent?.trim();
    expect(name).toBe(EFFECT_COPY.highpass?.title);
    expect(name).not.toBe(getAudioFxDef("highpass")?.label);
    // And a sentence under it, so the rack reads top to bottom.
    expect(node.querySelector(".hf-fx-node-summary")?.textContent).toContain("Cutting everything");
    // The first node is open by default, which is where the DSP name lives.
    expect(node.querySelector(".hf-fx-node-mechanism")?.textContent).toContain(
      getAudioFxDef("highpass")?.label,
    );
  });

  it("offers presets as the complaint they answer", () => {
    const { host } = mount({ chain: { version: 1, nodes: [] } });
    click(byText(host, "button", "Presets"));
    const item = presetButton(host, "telephone");
    expect(item?.querySelector(".hf-fx-preset-problem")?.textContent).toBe(
      PRESET_PROBLEM.telephone,
    );
    // The name is still there, under it — which is how it gets learned.
    expect(item?.querySelector(".hf-fx-preset-name")?.textContent).toBe("Telephone");
  });

  describe("hover-audition", () => {
    /** Focus is the keyboard's hover, and both go through the same handler. */
    const enter = (el: Element | null | undefined) => {
      if (!el) throw new Error("element not found");
      act(() => (el as HTMLElement).focus());
    };
    const leave = (host: HTMLElement, sel: string) =>
      act(() => {
        host.querySelector(sel)?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });

    it("plays a preset without committing to it", () => {
      const { host, onChainPreview, onChainChange } = mount({ chain: { version: 1, nodes: [] } });
      click(byText(host, "button", "Presets"));
      enter(presetButton(host, "telephone"));

      const heard = onChainPreview.mock.calls.at(-1)?.[0] as HfAudioFxChain;
      expect(heard.nodes.length).toBeGreaterThan(0);
      expect(heard.nodes.every((n) => n.fromPreset === "telephone")).toBe(true);
      // Heard, not written. Hovering is not a decision.
      expect(onChainChange).not.toHaveBeenCalled();
    });

    it("puts the chain back on the way out", () => {
      const { host, onChainPreview } = mount({ chain: chainOf("peaking") });
      click(byText(host, "button", "Presets"));
      enter(presetButton(host, "telephone"));
      leave(host, ".hf-fx-preset-menu");

      const back = onChainPreview.mock.calls.at(-1)?.[0] as HfAudioFxChain;
      expect(back.nodes.map((n) => n.type)).toEqual(["peaking"]);
    });

    it("does not put the old chain back over the preset it just applied", () => {
      // The audition WAS the preset, so reverting after the write is a race the
      // author hears as it arriving and then leaving again.
      //
      // Applying closes the shelf, so the pointer never leaves it — the revert
      // that would fire is the panel's own teardown, which is what unmounting
      // here exercises. It is also the real route: applying a preset and then
      // clicking another clip does exactly this.
      const { host, root, onChainPreview } = mount({ chain: { version: 1, nodes: [] } });
      click(byText(host, "button", "Presets"));
      enter(presetButton(host, "telephone"));
      const auditions = onChainPreview.mock.calls.length;
      click(presetButton(host, "telephone"));
      act(() => root.unmount());

      expect(onChainPreview.mock.calls.length).toBe(auditions);
    });

    it("puts the chain back if the panel goes away mid-audition", () => {
      // Deselecting the clip while hovering is not a decision either, and the
      // preview channel does not persist — so without this the author hears a
      // chain the document does not have until something else writes.
      const { host, root, onChainPreview } = mount({ chain: chainOf("peaking") });
      click(byText(host, "button", "Presets"));
      enter(presetButton(host, "telephone"));
      act(() => root.unmount());

      const back = onChainPreview.mock.calls.at(-1)?.[0] as HfAudioFxChain;
      expect(back.nodes.map((n) => n.type)).toEqual(["peaking"]);
    });

    it("survives the panel re-rendering under it, which playback does constantly", () => {
      // The group re-renders on every playhead tick to move the automation
      // readouts, handing down a fresh preview callback each time. A teardown
      // keyed on that callback ran on every tick, so an audition reverted itself
      // about thirty times a second — during playback, which is the only time
      // there is anything to audition.
      const { host, root, onChainPreview } = mount({ chain: chainOf("peaking") });
      click(byText(host, "button", "Presets"));
      enter(presetButton(host, "telephone"));
      const auditions = onChainPreview.mock.calls.length;

      // Same behaviour, new identity — exactly what a tick hands down.
      act(() =>
        root.render(
          <FxSection
            chain={chainOf("peaking")}
            onChainChange={vi.fn()}
            onChainPreview={(next) => onChainPreview(next)}
            carve={null}
            onCarveChange={vi.fn()}
            sourceOptions={[{ id: "vo", label: "Voiceover" }]}
          />,
        ),
      );

      expect(onChainPreview.mock.calls.length).toBe(auditions);
    });

    it("auditions an effect the add menu is offering", () => {
      const { host, onChainPreview, onChainChange } = mount({ chain: chainOf("peaking") });
      click(byText(host, "button", "Add effect"));
      enter(byText(host, "button", EFFECT_COPY.reverb?.title ?? ""));

      const heard = onChainPreview.mock.calls.at(-1)?.[0] as HfAudioFxChain;
      expect(heard.nodes.map((n) => n.type)).toEqual(["peaking", "reverb"]);
      expect(onChainChange).not.toHaveBeenCalled();
    });

    it("asks for a levelling measurement on hover, and calls it off on the way out", () => {
      // The one module that cannot answer instantly: there is nothing to hear
      // until the track has been decoded and measured.
      const onAuditionLevel = vi.fn();
      const { host } = mount({
        chain: { version: 1, nodes: [] },
        onLevel: vi.fn(),
        onAuditionLevel,
      });
      click(byText(host, "button", "Add effect"));
      enter(byText(host, "button", "Even Out Levels"));
      expect(onAuditionLevel).toHaveBeenLastCalledWith(true);
      leave(host, ".hf-fx-add-menu");
      expect(onAuditionLevel).toHaveBeenLastCalledWith(false);
    });
  });

  it("adds a preset to what is already there rather than replacing it", () => {
    const existing: HfAudioFxChain = {
      version: 1,
      nodes: [
        { type: "reverb", id: "mine", enabled: true, params: defaultAudioFxParams("reverb") },
      ],
    };
    const { host, onChainChange } = mount({ chain: existing });
    click(byText(host, "button", "Presets"));
    click(presetButton(host, "rumble-cut"));

    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes.map((n) => n.id)).toContain("mine");
    expect(next.nodes.map((n) => n.type)).toEqual(["reverb", "highpass"]);
  });

  it("shows a preset node by the job it is doing, not its filter type", () => {
    const { host } = mount({
      chain: {
        version: 1,
        nodes: [
          {
            type: "peaking",
            id: "a",
            label: "Reduce Mud",
            enabled: true,
            params: defaultAudioFxParams("peaking"),
          },
          {
            type: "peaking",
            id: "b",
            label: "Add Clarity",
            enabled: true,
            params: defaultAudioFxParams("peaking"),
          },
        ],
      } as HfAudioFxChain,
    });
    const names = Array.from(host.querySelectorAll(".hf-fx-node-name")).map((e) =>
      e.textContent?.trim(),
    );
    // Without the label both rows read "Peaking EQ" and an author cannot tell
    // which one is cutting and which is lifting.
    expect(names).toContain("Reduce Mud");
    expect(names).toContain("Add Clarity");
    expect(names).not.toContain("Peaking EQ");
  });

  it("adds a Tone EQ as three ordinary filters on one control surface", () => {
    const { host, onChainChange } = mount({ chain: { version: 1, nodes: [] } });
    click(host.querySelector(".hf-fx-add"));
    click(byText(host, ".hf-fx-add-composite", "Tone (EQ)"));

    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes.map((n) => n.type)).toEqual(["lowshelf", "peaking", "highshelf"]);
    expect(next.nodes.map((n) => n.label)).toEqual(["Bass", "Middle", "Treble"]);
    expect(next.nodes.every((n) => n.fromEq === "eq1")).toBe(true);
  });

  it("shows the EQ as one module, not as its individual bands", () => {
    // The bands belong to the Tone module. Listing them again in the rack would
    // put the same filter on screen twice with two ways to edit it.
    const { host } = mount({
      chain: {
        version: 1,
        nodes: [
          {
            type: "lowshelf",
            id: "a",
            fromEq: "eq1",
            label: "Bass",
            enabled: true,
            params: defaultAudioFxParams("lowshelf"),
          },
          {
            type: "peaking",
            id: "b",
            fromEq: "eq1",
            label: "Middle",
            enabled: true,
            params: defaultAudioFxParams("peaking"),
          },
          {
            type: "highshelf",
            id: "c",
            fromEq: "eq1",
            label: "Treble",
            enabled: true,
            params: defaultAudioFxParams("highshelf"),
          },
        ],
      } as HfAudioFxChain,
    });
    expect(host.querySelectorAll(".hf-fx-eq-module")).toHaveLength(1);
    const names = Array.from(host.querySelectorAll(".hf-fx-node-name")).map((e) =>
      e.textContent?.trim(),
    );
    expect(names).toContain("Tone");
    expect(names).not.toContain("Bass");
    // Closed, it says what it is doing rather than listing three zeroes.
    expect(host.querySelector(".hf-fx-eq-summary")?.textContent).toMatch(/^Flat/);
  });

  it("moves one band without persisting until the fader is released", () => {
    const { host, onChainChange, onChainPreview } = mount({
      chain: {
        version: 1,
        nodes: [
          {
            type: "lowshelf",
            id: "a",
            fromEq: "eq1",
            label: "Bass",
            enabled: true,
            params: defaultAudioFxParams("lowshelf"),
          },
          {
            type: "peaking",
            id: "b",
            fromEq: "eq1",
            label: "Middle",
            enabled: true,
            params: defaultAudioFxParams("peaking"),
          },
          {
            type: "highshelf",
            id: "c",
            fromEq: "eq1",
            label: "Treble",
            enabled: true,
            params: defaultAudioFxParams("highshelf"),
          },
        ],
      } as HfAudioFxChain,
    });
    // The carve module leads the rack, so its header is the first one — open
    // the EQ's own.
    click(host.querySelector(".hf-fx-eq-module .hf-fx-node-name"));
    const fader = host.querySelectorAll<HTMLInputElement>(".hf-fx-eq-fader")[0]!;
    expect(fader, "the EQ did not open").toBeTruthy();
    typeInto(fader, "4");
    // Heard, not written — a persisting write per drag event reloads the
    // composition and restarts the audio.
    expect(onChainPreview).toHaveBeenCalled();
    expect(onChainChange).not.toHaveBeenCalled();

    act(() => fader.dispatchEvent(new Event("pointerup", { bubbles: true })));
    const next = onChainChange.mock.calls[0]![0] as HfAudioFxChain;
    expect(next.nodes.find((n) => n.label === "Bass")!.params!.gain).toBe(4);
    expect(next.nodes.find((n) => n.label === "Middle")!.params!.gain).toBe(0);
  });

  it("offers levelling, and offers to take it away once it is there", () => {
    const onLevel = vi.fn();
    const onRemoveLevel = vi.fn();
    const { host } = mount({ onLevel, onRemoveLevel });
    click(host.querySelector(".hf-fx-add"));
    click(byText(host, ".hf-fx-add-composite", "Even Out Levels"));
    expect(onLevel).toHaveBeenCalledTimes(1);

    const already = mount({ onLevel, onRemoveLevel, levelled: true });
    click(already.host.querySelector(".hf-fx-add"));
    // The same control, because adding a second levelling stage is never what
    // an author means by pressing it twice.
    click(byText(already.host, ".hf-fx-add-composite", "Remove levelling"));
    expect(onRemoveLevel).toHaveBeenCalledTimes(1);
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
    const slider = fxCard(host).querySelector<HTMLInputElement>(".hf-fx-slider")!;
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

  it("stays where it was dropped while the write is still coming back", () => {
    // The value only returns after the attribute is written and the selection
    // resynced — and for a carve, after the analysis that write kicks off. Dropping
    // back to the prop in that gap made the control snap to where the drag started
    // and then jump to where it ended.
    const { host } = mount({ chain: chainOf("peaking") });
    const card = fxCard(host);
    const slider = card.querySelector<HTMLInputElement>(".hf-fx-slider")!;
    const number = card.querySelector<HTMLInputElement>(".hf-fx-number")!;
    const before = number.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => slider.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => {
      setter?.call(slider, "8000");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const dragged = number.value;
    expect(dragged).not.toBe(before);
    // Release. The parent is a spy here, so the prop never updates — exactly the
    // window the snap happened in.
    act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
    expect(number.value).toBe(dragged);
  });

  it("adopts a value that comes back different from the one dragged to", () => {
    // Held only until there is newer information — a clamp upstream, an undo, or
    // any other write must still win over the gesture's own guess.
    const shared = {
      onChainChange: vi.fn(),
      onChainPreview: vi.fn(),
      carve: null,
      onCarveChange: vi.fn(),
      sourceOptions: [{ id: "vo", label: "Voiceover" }],
    };
    const { host, root } = renderInto(<FxSection {...shared} chain={chainOf("peaking")} />);
    const slider = fxCard(host).querySelector<HTMLInputElement>(".hf-fx-slider")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => slider.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => {
      setter?.call(slider, "8000");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
    // The write came back as something else entirely.
    act(() =>
      root.render(
        <FxSection
          {...shared}
          chain={{
            version: 1,
            nodes: [
              {
                type: "peaking",
                enabled: true,
                params: { ...defaultAudioFxParams("peaking"), frequency: 1234 },
              },
            ],
          }}
        />,
      ),
    );
    expect(fxCard(host).querySelector<HTMLInputElement>(".hf-fx-number")!.value).toBe("1234");
  });

  it("commits an enum immediately, since a select has no drag", () => {
    const { host, onChainChange } = mount({ chain: chainOf("saturate") });
    const select = fxCard(host).querySelector<HTMLSelectElement>(".hf-fx-select")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter?.call(select, "atan");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChainChange).toHaveBeenCalledTimes(1);
  });

  it("clamps a typed value into the renderable range", () => {
    const { host, onChainChange } = mount({ chain: chainOf("peaking") });
    const input = fxCard(host).querySelector<HTMLInputElement>(".hf-fx-number")!;
    typeInto(input, "999999");
    // React delegates onBlur through focusout, which is the event that bubbles.
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    const next = onChainChange.mock.calls.at(-1)![0] as HfAudioFxChain;
    expect(next.nodes[0]!.params!.frequency).toBe(20000);
  });
});

describe("FxSection carve module", () => {
  /**
   * A carve is one thing an author turned on, not the six filters it happens to
   * compile to. Listed individually they read as hand-built effects: removable
   * one at a time, reorderable, each with knobs that the next strength change
   * overwrites without warning.
   */
  it("shows the carve's effects as one module, alongside hand-built ones", () => {
    const { host } = mount({ chain: carved });
    const rows = Array.from(host.querySelectorAll<HTMLElement>(".hf-fx-node"));
    // One row for the carve, one for the low-pass the author added.
    expect(rows).toHaveLength(2);
    expect(host.querySelector(".hf-fx-carve-module")).not.toBeNull();
    expect(host.querySelector(".hf-fx-carve-module")?.textContent).toContain("Voiceover carve");
  });

  it("says what the module contains, since its parts are not listed", () => {
    const { host } = mount({ chain: carved });
    const text = host.querySelector(".hf-fx-carve-module")?.textContent ?? "";
    expect(text).toMatch(/2 bands/);
    expect(text).toMatch(/level/);
  });

  it("offers one switch for the whole carve, not a bypass and a delete", () => {
    // The module is the unit: there is nothing meaningful between "carving" and
    // "not carving", and two buttons implied there was.
    const { host } = mount({ chain: carved });
    const module = host.querySelector<HTMLElement>(".hf-fx-carve-module")!;
    expect(module.querySelectorAll(".hf-fx-remove")).toHaveLength(0);
    expect(module.querySelectorAll(".hf-fx-carve-toggle")).toHaveLength(1);
  });

  it("switching it off records that, rather than erasing the settings", () => {
    // An absent carve reads as never-configured, and a bed with one voice above it
    // is carved by default — so erasing would re-apply it on the next selection.
    const onCarveChange = vi.fn();
    const { host } = mount({
      chain: carved,
      carve: { ...DEFAULT_CARVE, sources: ["vo"] },
      onCarveChange,
    });
    act(() => host.querySelector<HTMLButtonElement>(".hf-fx-carve-toggle")!.click());
    expect(onCarveChange).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, sources: ["vo"] }),
    );
  });

  it("lists what each effect inside it is set to", () => {
    // Grouped is not hidden: the carve compiles to real filters and an author has
    // to be able to see where they landed. What they cannot do is edit them by
    // hand — strength owns those numbers — so the settings read out rather than
    // offering controls that the next adjustment would overwrite.
    const { host } = mount({ chain: carved });
    const module = ensureCarveOpen(host);
    const members = Array.from(module.querySelectorAll<HTMLElement>(".hf-fx-carve-member"));
    expect(members).toHaveLength(3);
    // Named by what tells them apart, the way the timeline lanes name them.
    expect(members.map((m) => m.querySelector(".hf-fx-carve-member-name")?.textContent)).toEqual([
      "Peaking EQ 400 Hz",
      "Peaking EQ 1.6 kHz",
      "Gain",
    ]);
    // And every one of its settings is visible.
    const first = members[0]!.textContent ?? "";
    expect(first).toContain("Gain");
    expect(first).toMatch(/-6(\.0)? dB/);
    expect(first).toMatch(/1\.4/); // Q
  });

  it("reads the analysis out rather than offering controls over it", () => {
    // The module's own knobs — voice, strength, dynamic — are the carve's controls.
    // What the analysis produced is not editable by hand: strength owns those
    // numbers and the next adjustment would overwrite anything typed here.
    const { host } = mount({ chain: carved });
    const module = ensureCarveOpen(host);
    expect(module.querySelector(".hf-fx-carve-members")!.querySelectorAll("input")).toHaveLength(0);
    // The controls themselves are present, in the same card.
    expect(module.querySelectorAll(".hf-fx-carve-controls input").length).toBeGreaterThan(0);
    expect(module.querySelector(".hf-fx-carve-controls .hf-fx-carve-source")).not.toBeNull();
  });

  it("says which of them the timeline is driving", () => {
    // A carve in dynamic mode automates every one of these, and that is where the
    // values come from — so the module has to point at the lane rather than look
    // like a static setting.
    const { host } = mount({
      chain: carved,
      automatedTargets: new Set(["fx.n1.gain", "fx.n3.gain"]),
    });
    const module = ensureCarveOpen(host);
    const automated = Array.from(module.querySelectorAll("[data-automated]"));
    expect(automated).toHaveLength(2);
  });

  it("keeps the summary readable while collapsed", () => {
    const { host } = mount({ chain: carved });
    const module = host.querySelector<HTMLElement>(".hf-fx-carve-module")!;
    // Collapse it: the module opens by default now, because it holds the controls.
    act(() => module.querySelector<HTMLButtonElement>(".hf-fx-node-name")!.click());
    expect(module.querySelectorAll(".hf-fx-carve-member")).toHaveLength(0);
    expect(module.querySelectorAll(".hf-fx-carve-controls")).toHaveLength(0);
    expect(module.textContent).toContain("2 bands + level");
  });

  it("offers no per-effect controls inside the module", () => {
    // Reordering or editing one band is meaningless: the next strength change
    // rewrites every one of them.
    const { host } = mount({ chain: carved });
    const module = host.querySelector(".hf-fx-carve-module")!;
    expect(module.querySelectorAll(".hf-fx-move")).toHaveLength(0);
    // One range in the card — Strength, the carve's own — and none per band.
    expect(module.querySelectorAll("input[type=range]")).toHaveLength(1);
    expect(module.querySelectorAll(".hf-fx-carve-members input[type=range]")).toHaveLength(0);
  });
});

describe("FxSection carve", () => {
  it("is off by default and is not an entry in the chain", () => {
    const { host } = mount();
    expect(host.querySelector(".hf-fx-carve")).toBeTruthy();
    const items = openAddMenuItems(host);
    expect(items).not.toContain("Voiceover carve");
  });

  it("presents itself on, at the default strength", () => {
    // A bed under a voice wants carving, so the module does not start switched off
    // waiting to be discovered.
    const { host } = mount();
    const module = host.querySelector<HTMLElement>(".hf-fx-carve-module")!;
    expect(module.querySelector(".hf-fx-carve-toggle")?.getAttribute("aria-pressed")).toBe("true");
    expect(
      Number(module.querySelector<HTMLInputElement>(".hf-fx-carve-controls .hf-fx-number")!.value),
    ).toBe(DEFAULT_CARVE.strength);
    // No dynamic switch: every carve follows the voice now, because a static one
    // thinned the bed through every pause and nobody wanted that once they heard both.
    expect(module.querySelector(".hf-fx-carve-dynamic")).toBeNull();
  });

  it("lists every other audio track as something to make room for", () => {
    // Two candidates, so they are things to include rather than one readout.
    const { host } = mount({
      carve: { ...DEFAULT_CARVE },
      sourceOptions: [
        { id: "vo", label: "Voiceover" },
        { id: "nar", label: "Narration" },
      ],
    });
    const options = Array.from(host.querySelectorAll(".hf-fx-carve-sources label")).map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toContain("Voiceover");
    expect(options).toContain("Narration");
  });

  it("offers no analyse button — picking a voice is the whole gesture", () => {
    // A carve with a source and no filters is a setting nobody applied; the
    // button was a second step for something the panel already knew to do.
    const { host } = mount({ carve: { ...DEFAULT_CARVE, sources: ["vo"] } });
    expect(host.querySelector(".hf-fx-analyse")).toBeNull();
    // No button offering it. The card may still SAY the analysis has not happened —
    // that is a status, not a step to take.
    const buttons = Array.from(host.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(buttons.filter((t) => /analys/i.test(t))).toHaveLength(0);
  });

  it("says when it is working, since there is no button to grey out", () => {
    const { host } = mount({ carve: { ...DEFAULT_CARVE, sources: ["vo"] }, analysing: true });
    expect(host.querySelector(".hf-fx-carve-working")?.textContent).toMatch(/Analysing/i);
    // A spinner, not just a word: the analysis decodes both tracks and can take a
    // moment, and a static line reads as a state rather than as work in progress.
    expect(host.querySelector(".hf-fx-carve-spinner")).not.toBeNull();
    // Honours a reader who asked for less movement.
    expect(host.querySelector(".hf-fx-carve-spinner")?.getAttribute("class")).toContain(
      "motion-reduce:animate-none",
    );
  });

  it("clears the previous analysis while a new one runs", () => {
    // Moving strength re-derives every one of those numbers, so leaving them up
    // shows settings that are already history as though they were in force.
    const { host } = mount({
      chain: carved,
      carve: { ...DEFAULT_CARVE, sources: ["vo"] },
      analysing: true,
    });
    const module = host.querySelector<HTMLElement>(".hf-fx-carve-module")!;
    expect(module.querySelectorAll(".hf-fx-carve-member")).toHaveLength(0);
    expect(module.querySelector(".hf-fx-carve-spinner")).not.toBeNull();
    // The controls stay put — only the analysis is in flight.
    expect(module.querySelector(".hf-fx-carve-controls .hf-fx-slider")).not.toBeNull();
  });

  it("shows the analysis again once it lands", () => {
    const { host } = mount({ chain: carved, carve: { ...DEFAULT_CARVE, sources: ["vo"] } });
    const module = host.querySelector<HTMLElement>(".hf-fx-carve-module")!;
    expect(module.querySelectorAll(".hf-fx-carve-member").length).toBeGreaterThan(0);
    expect(module.querySelector(".hf-fx-carve-spinner")).toBeNull();
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
    expect(
      rowFor(host, plainLabel("saturate", "output"))?.querySelector(".hf-fx-automate"),
    ).toBeTruthy();
    expect(
      rowFor(host, plainLabel("saturate", "threshold"))?.querySelector(".hf-fx-automate"),
    ).toBeNull();
  });

  it("offers nothing for a worklet effect, which exposes no AudioParams", () => {
    const { host } = automatable(idChain("compressor"));
    expect(host.querySelectorAll(".hf-fx-automate").length).toBe(0);
  });

  it("asks to automate a parameter by node id and key", () => {
    const onAutomateParam = vi.fn();
    const { host } = automatable(idChain("lowpass", "n7"), { onAutomateParam });
    const button = rowFor(host, plainLabel("lowpass", "frequency"))!.querySelector(
      ".hf-fx-automate",
    ) as HTMLButtonElement;
    expect(button.hasAttribute("title")).toBe(false);
    act(() => button.click());
    expect(onAutomateParam).toHaveBeenCalledWith("n7", "frequency");
  });

  it("disables an automated control, since a value typed here would be overwritten", () => {
    const { host } = automatable(idChain("lowpass"), {
      automatedTargets: new Set(["fx.n1.frequency"]),
    });
    const row = rowFor(host, plainLabel("lowpass", "frequency"))!;
    expect(row.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    expect(row.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true);
    expect(row.hasAttribute("data-automated")).toBe(true);
    // A sibling parameter on the same effect stays editable.
    const q = rowFor(host, plainLabel("lowpass", "q"))!;
    expect(q.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(false);
  });

  it("turns the automated parameter's button into a delete", () => {
    const onRemoveParamAutomation = vi.fn();
    const { host } = automatable(idChain("lowpass"), {
      automatedTargets: new Set(["fx.n1.frequency"]),
      onRemoveParamAutomation,
    });
    const button = rowFor(host, plainLabel("lowpass", "frequency"))!.querySelector(
      ".hf-fx-automate",
    ) as HTMLButtonElement;
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
      const button = rowFor(host, plainLabel("lowpass", "frequency"))!.querySelector(
        ".hf-fx-automate",
      ) as HTMLButtonElement;
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
      (b) => b.textContent === EFFECT_COPY.lowpass?.title,
    )!;
    act(() => item.click());
    expect(onChainChange.mock.calls[0][0].nodes[0].id).toBe("n1");
  });
});

describe("voiceover carve visibility", () => {
  const carveBlock = (host: HTMLElement) => host.querySelector(".hf-fx-carve");

  it("is hidden when the composition has no other audio track to listen to", () => {
    // Carve dips this bed where another track's voice sits. Alone, the control
    // could only offer an empty picker.
    const { host } = mount({ chain: chainOf("lowpass"), sourceOptions: [] });
    expect(carveBlock(host)).toBeNull();
  });

  it("is shown once there is another audio track", () => {
    const { host } = mount({
      chain: chainOf("lowpass"),
      sourceOptions: [{ id: "vo", label: "vo" }],
    });
    expect(carveBlock(host)).toBeTruthy();
  });

  it("stays shown for an existing carve whose voice track has gone", () => {
    // Otherwise the setting would keep dipping the bed from out of sight.
    const { host } = mount({
      chain: chainOf("lowpass"),
      sourceOptions: [],
      carve: { ...DEFAULT_CARVE, sources: ["vo"] },
    });
    expect(carveBlock(host)).toBeTruthy();
  });
});
