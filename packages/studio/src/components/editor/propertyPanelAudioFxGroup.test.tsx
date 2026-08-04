// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { AudioFxGroup } from "./propertyPanelAudioFxGroup.js";
import type { DomEditSelection } from "./domEditingTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHAIN = JSON.stringify({
  version: 1,
  nodes: [{ type: "lowpass", id: "n1", params: { frequency: 900, q: 1.2, poles: "2" } }],
});

// Each mount appends its tracks to the document; without clearing, a later
// "only one audio track" case would still find the previous test's sibling.
afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * A selected `<audio>` with a sibling track, so carve — which needs another
 * track to listen to — is offered. Pass `alone` for a composition holding just
 * this one.
 */
function audioSelection(dataAttributes: Record<string, string>, alone = false): DomEditSelection {
  const bed = document.createElement("audio");
  bed.id = "bed";
  document.body.append(bed);
  if (!alone) {
    const voice = document.createElement("audio");
    voice.id = "vo";
    document.body.append(voice);
  }
  return { dataAttributes, id: "bed", element: bed } as unknown as DomEditSelection;
}

function mount(dataAttributes: Record<string, string>, alone = false) {
  // Every write is quiet: persisted without the preview reload that would
  // restart every playing track, but with a selection resync so the panel sees
  // what it just wrote.
  const onSetAttributeQuiet = vi.fn();
  const onSetAttributeLive = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const selection = audioSelection(dataAttributes, alone);
  act(() => {
    createRoot(host).render(
      <AudioFxGroup
        element={selection}
        onSetAttributeQuiet={onSetAttributeQuiet}
        onSetAttributeLive={onSetAttributeLive}
      />,
    );
  });
  return { host, onSetAttributeQuiet, onSetAttributeLive };
}

const rowFor = (host: HTMLElement, label: string): HTMLElement | null => {
  for (const row of Array.from(host.querySelectorAll<HTMLElement>(".hf-fx-row"))) {
    if (row.querySelector(".hf-fx-label")?.textContent === label) return row;
  }
  return null;
};

const parseWrite = (call: unknown[]) => JSON.parse(String(call[1]));

describe("AudioFxGroup automation", () => {
  it("renders the chain's parameters", () => {
    const { host } = mount({ "fx-chain": CHAIN });
    expect(rowFor(host, "Cutoff")).toBeTruthy();
    expect(rowFor(host, "Q")).toBeTruthy();
  });

  it("seeds a new lane at the value the control already holds", () => {
    // Switching to an envelope must not change the sound — only where the value
    // comes from. The chain has frequency at 900, not the registry default.
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": CHAIN });
    const button = rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement;
    act(() => button.click());
    const [attr, value] = onSetAttributeQuiet.mock.calls[0];
    expect(attr).toBe("data-automation");
    expect(JSON.parse(String(value))).toEqual({
      version: 1,
      lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 900 }] }],
    });
  });

  it("keeps lanes it is not touching when adding one", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "volume", points: [{ t: 0, v: 0.5 }] }],
      }),
    });
    act(() => (rowFor(host, "Q")!.querySelector(".hf-fx-automate") as HTMLButtonElement).click());
    expect(
      parseWrite(onSetAttributeQuiet.mock.calls[0]).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["volume", "fx.n1.q"]);
  });

  it("disables a control the timeline already drives", () => {
    const { host } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
      }),
    });
    const cutoff = rowFor(host, "Cutoff")!;
    expect(cutoff.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    expect(cutoff.hasAttribute("data-automated")).toBe(true);
    expect(
      rowFor(host, "Q")!.querySelector<HTMLInputElement>('input[type="range"]')?.disabled,
    ).toBe(false);
  });

  it("deletes just that lane, handing the value back to the control", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [
          { target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] },
          { target: "volume", points: [{ t: 0, v: 0.5 }] },
        ],
      }),
    });
    act(() =>
      (rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement).click(),
    );
    expect(
      parseWrite(onSetAttributeQuiet.mock.calls[0]).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["volume"]);
  });

  it("clears the attribute when the last lane goes", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] }],
      }),
    });
    act(() =>
      (rowFor(host, "Cutoff")!.querySelector(".hf-fx-automate") as HTMLButtonElement).click(),
    );
    // Null rather than "": the live path removes an attribute it is given null for.
    expect(onSetAttributeQuiet.mock.calls[0][1]).toBeNull();
  });

  it("ignores a lane for an effect that is no longer in the chain", () => {
    const { host } = mount({
      "fx-chain": CHAIN,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.gone.frequency", points: [{ t: 0, v: 400 }] }],
      }),
    });
    // Nothing is automated, so every control stays live.
    expect(
      rowFor(host, "Cutoff")!.querySelector<HTMLInputElement>('input[type="range"]')?.disabled,
    ).toBe(false);
  });
});

describe("AudioFxGroup carve", () => {
  const carvedChain = JSON.stringify({
    version: 1,
    nodes: [
      { type: "peaking", id: "n1", fromCarve: true, params: { frequency: 900, gain: -6, q: 1.4 } },
      { type: "lowpass", id: "n2", params: { frequency: 400, q: 0.9, poles: "2" } },
    ],
  });

  const carveOn = JSON.stringify({
    source: "vo",
    maxCutDb: 6,
    bands: 3,
    q: 1.4,
    intelligibilityBias: 0.7,
  });

  const carveToggle = (host: HTMLElement): HTMLButtonElement => {
    const block = host.querySelector(".hf-fx-carve")!;
    return block.querySelector(".hf-fx-bypass") as HTMLButtonElement;
  };

  it("removes the filters it generated when carve is switched off", async () => {
    // Leaving them behind would keep dipping the bed with no carve to explain it.
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": carvedChain,
      "fx-carve": carveOn,
    });
    await act(async () => {
      carveToggle(host).click();
    });
    const chainWrite = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-chain");
    expect(chainWrite).toBeTruthy();
    const kept = JSON.parse(String(chainWrite![1])).nodes;
    expect(kept.map((n: { type: string }) => n.type)).toEqual(["lowpass"]);
    // And the carve settings themselves go — after the chain write, not
    // alongside it: both are read-modify-writes of the same file, so fired
    // together the later one reads pre-edit content and drops the earlier.
    expect(onSetAttributeQuiet.mock.calls.map((c) => c[0])).toEqual([
      "data-fx-chain",
      "data-fx-carve",
    ]);
    expect(onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-carve")?.[1]).toBeNull();
  });

  it("leaves a hand-built chain alone when carve is switched off", () => {
    const handBuilt = JSON.stringify({
      version: 1,
      nodes: [{ type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } }],
    });
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": handBuilt, "fx-carve": carveOn });
    act(() => carveToggle(host).click());
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-chain")).toBe(false);
  });

  it("drags a carve dial live and persists once on release", () => {
    // Without the split every pointermove patched the source file and resynced
    // the selection, which is what makes the audio stutter mid-drag.
    const { host, onSetAttributeQuiet, onSetAttributeLive } = mount({
      "fx-chain": carvedChain,
      "fx-carve": carveOn,
    });
    const dial = host.querySelector<HTMLInputElement>(".hf-fx-carve input[type=range]");
    expect(dial).not.toBeNull();
    act(() => {
      // React's value tracker swallows a plain assignment, so go through the
      // prototype setter the way the other panel tests do.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(dial, "0.5");
      dial?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSetAttributeLive.mock.calls.map((c) => c[0])).toEqual(["data-fx-carve"]);
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-carve")).toBe(false);
    act(() => dial?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-fx-carve")).toBe(true);
  });

  it("writes carve settings live, so enabling it does not reload the preview", () => {
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": carvedChain });
    act(() => carveToggle(host).click());
    const write = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-fx-carve");
    expect(write).toBeTruthy();
    expect(JSON.parse(String(write![1])).bands).toBeGreaterThan(0);
  });
});

describe("AudioFxGroup successive edits", () => {
  const three = JSON.stringify({
    version: 1,
    nodes: [
      { type: "peaking", id: "n1", params: { frequency: 900, gain: -6, q: 1.4 } },
      { type: "lowpass", id: "n2", params: { frequency: 400, q: 0.9, poles: "2" } },
      { type: "delay", id: "n3", params: { time: 250, feedback: 0.3, mix: 0.4 } },
    ],
  });

  const removeButtons = (host: HTMLElement) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".hf-fx-remove"));

  /**
   * The panel computes each edit from the attribute it is holding. Written
   * without a selection resync, the second delete worked from the pre-delete
   * chain and wrote the same result — so after deleting one effect, no further
   * delete did anything.
   */
  it("deletes a second effect after the first, not from a stale chain", () => {
    const first = mount({ "fx-chain": three });
    act(() => removeButtons(first.host)[0]!.click());
    const afterFirst = JSON.parse(String(first.onSetAttributeQuiet.mock.calls[0][1]));
    expect(afterFirst.nodes.map((n: { id: string }) => n.id)).toEqual(["n2", "n3"]);

    // The resync hands the panel what it just wrote; the next delete starts there.
    const second = mount({ "fx-chain": JSON.stringify(afterFirst) });
    act(() => removeButtons(second.host)[0]!.click());
    const afterSecond = JSON.parse(String(second.onSetAttributeQuiet.mock.calls[0][1]));
    expect(afterSecond.nodes.map((n: { id: string }) => n.id)).toEqual(["n3"]);

    const third = mount({ "fx-chain": JSON.stringify(afterSecond) });
    act(() => removeButtons(third.host)[0]!.click());
    // The last one leaves no chain at all.
    expect(third.onSetAttributeQuiet.mock.calls[0][1]).toBeNull();
  });

  it("writes with the commit that resyncs the selection, not the silent one", () => {
    // Both skip the preview reload; only this one re-reads the selection, which
    // is what makes a following edit see the current value.
    const { host, onSetAttributeQuiet } = mount({ "fx-chain": three });
    act(() => removeButtons(host)[0]!.click());
    expect(onSetAttributeQuiet).toHaveBeenCalledTimes(1);
    expect(onSetAttributeQuiet.mock.calls[0][0]).toBe("data-fx-chain");
  });
});

describe("AudioFxGroup carve visibility", () => {
  it("offers carve when the composition holds another audio track", () => {
    const { host } = mount({ "fx-chain": CHAIN });
    expect(host.querySelector(".hf-fx-carve")).toBeTruthy();
  });

  it("does not offer carve for the only audio track in the composition", () => {
    // Nothing to listen to, so the picker would be empty and Analyse inert.
    const { host } = mount({ "fx-chain": CHAIN }, true);
    expect(host.querySelector(".hf-fx-carve")).toBeNull();
  });
});

describe("AudioFxGroup deleting an effect", () => {
  const twoNodes = JSON.stringify({
    version: 1,
    nodes: [
      { type: "lowpass", id: "n1", params: { frequency: 400, q: 0.9, poles: "2" } },
      { type: "peaking", id: "n2", params: { frequency: 900, gain: -6, q: 1 } },
    ],
  });

  it("takes the deleted node's lanes with it", () => {
    // resolveAutomation only hides an orphan at read time. Left in the attribute,
    // and with ids minted lowest-free, the next effect added takes the same id and
    // inherits the dead envelope — disabled and "Automated" without the author
    // ever automating it, and baked into the render.
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": twoNodes,
      automation: JSON.stringify({
        version: 1,
        lanes: [
          { target: "fx.n1.frequency", points: [{ t: 0, v: 400 }] },
          { target: "fx.n2.gain", points: [{ t: 0, v: -6 }] },
          { target: "volume", points: [{ t: 0, v: 1 }] },
        ],
      }),
    });
    const remove = host.querySelectorAll<HTMLButtonElement>(".hf-fx-remove")[0]!;
    act(() => remove.click());
    const automationWrite = onSetAttributeQuiet.mock.calls.find((c) => c[0] === "data-automation");
    expect(automationWrite).toBeTruthy();
    expect(
      JSON.parse(String(automationWrite![1])).lanes.map((l: { target: string }) => l.target),
    ).toEqual(["fx.n2.gain", "volume"]);
  });

  it("leaves automation alone when the deleted node had none", () => {
    const { host, onSetAttributeQuiet } = mount({
      "fx-chain": twoNodes,
      automation: JSON.stringify({
        version: 1,
        lanes: [{ target: "fx.n2.gain", points: [{ t: 0, v: -6 }] }],
      }),
    });
    act(() => host.querySelectorAll<HTMLButtonElement>(".hf-fx-remove")[0]!.click());
    expect(onSetAttributeQuiet.mock.calls.some((c) => c[0] === "data-automation")).toBe(false);
  });
});
