import { describe, expect, it } from "vitest";

import { detectConnectorMotionDetached } from "./checkPipeline.js";
import type { ConnectorFrame, ConnectorLineSample, ConnectorNodeBox } from "./checkTypes.js";

const CANVAS = { width: 1000, height: 1000 };
// Two nodes: a hub near the centre and a satellite the connector should reach.
const HUB: ConnectorNodeBox = { selector: "#hub", left: 480, top: 480, right: 520, bottom: 520 };
const SATELLITE: ConnectorNodeBox = {
  selector: "#sat",
  left: 780,
  top: 480,
  right: 860,
  bottom: 520,
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

  it("drops a selector that aliases multiple connectors in one frame", () => {
    const frames: ConnectorFrame[] = danglingFrames().map((f) => ({
      ...f,
      connectors: [...f.connectors, { selector: "#spoke", ax: 500, ay: 500, bx: 820, by: 500 }],
    }));
    expect(detectConnectorMotionDetached(frames, CANVAS)).toHaveLength(0);
  });
});
