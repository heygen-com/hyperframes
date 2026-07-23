import { describe, expect, it } from "vitest";

import { detectConnectorMotionDetached } from "./checkPipeline.js";
import type { ConnectorFrame, ConnectorLineSample, ConnectorNodeBox } from "./checkTypes.js";

const CANVAS = { width: 1000, height: 1000 };
// Two nodes: a hub near the centre and a satellite the connector should reach.
const HUB: ConnectorNodeBox = {
  selector: "#hub",
  left: 480,
  top: 480,
  right: 520,
  bottom: 520,
  ring: false,
};
const SATELLITE: ConnectorNodeBox = {
  selector: "#sat",
  left: 780,
  top: 480,
  right: 860,
  bottom: 520,
  ring: false,
};

function frame(
  time: number,
  connector: ConnectorLineSample,
  nodes: ConnectorNodeBox[],
): ConnectorFrame {
  return { time, connectors: [connector], nodes };
}

/** A dangling connector: end A stays on the hub, end B sits ~180px from every
 * node across all held frames — the half-attached signature (fuzz011). */
function danglingFrames(): ConnectorFrame[] {
  return [0, 2, 4, 6, 8].map((time) =>
    frame(time, { selector: "#spoke", ax: 500, ay: 500, bx: 640, by: 500 }, [HUB, SATELLITE]),
  );
}

describe("detectConnectorMotionDetached", () => {
  it("fires when one endpoint is anchored and the other dangles in empty space", () => {
    const findings = detectConnectorMotionDetached(danglingFrames(), CANVAS);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.code).toBe("connector_motion_detached");
    expect(f?.severity).toBe("warning");
    expect(f?.selector).toBe("#spoke");
    expect(f?.message).toContain("empty space");
  });

  it("stays quiet when both endpoints reach a node", () => {
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#spoke", ax: 500, ay: 500, bx: 820, by: 500 }, [HUB, SATELLITE]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });

  it("stays quiet when the loose end is only mildly short of a node", () => {
    // End B sits 40px from the satellite — under the 80px detach floor.
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#spoke", ax: 500, ay: 500, bx: 740, by: 500 }, [HUB, SATELLITE]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });

  it("stays quiet when BOTH endpoints float free (no anchor)", () => {
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#spoke", ax: 100, ay: 100, bx: 300, by: 100 }, [HUB, SATELLITE]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });

  it("only considers held frames — an entrance-only detachment does not fire", () => {
    // Detached early (t<0.45*dur=3.6) then anchored on every held frame.
    const frames: ConnectorFrame[] = [
      frame(0, { selector: "#spoke", ax: 500, ay: 500, bx: 640, by: 500 }, [HUB, SATELLITE]),
      frame(2, { selector: "#spoke", ax: 500, ay: 500, bx: 640, by: 500 }, [HUB, SATELLITE]),
      frame(4, { selector: "#spoke", ax: 500, ay: 500, bx: 820, by: 500 }, [HUB, SATELLITE]),
      frame(6, { selector: "#spoke", ax: 500, ay: 500, bx: 820, by: 500 }, [HUB, SATELLITE]),
      frame(8, { selector: "#spoke", ax: 500, ay: 500, bx: 820, by: 500 }, [HUB, SATELLITE]),
    ];
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });

  it("does not fire with fewer than the minimum frames", () => {
    expect(detectConnectorMotionDetached(danglingFrames().slice(0, 3), CANVAS)).toHaveLength(0);
  });

  // Hollow ring centred at 900,500; bbox left stroke is at x=700.
  const RING: ConnectorNodeBox = {
    selector: "#ring",
    left: 700,
    top: 300,
    right: 1100,
    bottom: 700,
    ring: true,
  };

  it("treats a loose end landing on a ring's stroke as anchored (no fire)", () => {
    // End B at 708,500 sits ~8px inside the ring's left stroke → anchored.
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#spoke", ax: 500, ay: 500, bx: 708, by: 500 }, [HUB, RING]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });

  it("does not fire on a gauge needle: anchored at the arc centre, loose end radially outward", () => {
    // Arc ring centred at 900,500; needle base on the hub near centre, tip out
    // past the arc — a pointer, not a broken connector.
    const hub: ConnectorNodeBox = {
      selector: "#hub",
      left: 890,
      top: 490,
      right: 910,
      bottom: 510,
      ring: false,
    };
    const arc: ConnectorNodeBox = {
      selector: "#arc",
      left: 700,
      top: 300,
      right: 1100,
      bottom: 700,
      ring: true,
    };
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#needle", ax: 900, ay: 500, bx: 900, by: 180 }, [hub, arc]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });

  it("still fires on a radial connector drifting toward the centre (not outward)", () => {
    // Anchored on a peripheral node; loose end drifts inward to empty space near
    // a ring centre — the fuzz011 shape, opposite of a gauge pointer.
    const peripheral: ConnectorNodeBox = {
      selector: "#panel",
      left: 120,
      top: 120,
      right: 260,
      bottom: 200,
      ring: false,
    };
    const arc: ConnectorNodeBox = {
      selector: "#arc",
      left: 700,
      top: 300,
      right: 1100,
      bottom: 700,
      ring: true,
    };
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#spoke", ax: 180, ay: 160, bx: 900, by: 500 }, [peripheral, arc]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(1);
  });

  it("still fires when the loose end sits in a ring's hollow centre", () => {
    // End B at the ring centre 900,500 is ~200px from its perimeter → dangling.
    const frames = [0, 2, 4, 6, 8].map((time) =>
      frame(time, { selector: "#spoke", ax: 500, ay: 500, bx: 900, by: 500 }, [HUB, RING]),
    );
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(1);
  });

  it("drops a selector that aliases multiple connectors in one frame", () => {
    const frames: ConnectorFrame[] = danglingFrames().map((f) => ({
      ...f,
      connectors: [...f.connectors, { selector: "#spoke", ax: 500, ay: 500, bx: 820, by: 500 }],
    }));
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });
});
