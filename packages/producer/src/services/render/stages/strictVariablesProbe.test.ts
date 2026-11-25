import { describe, expect, it } from "vitest";
import type { CaptureSession } from "@hyperframes/engine";
import type { RenderConfig } from "../../renderOrchestrator.js";
import { probeRequiresBrowser, strictVariablesAttestation } from "./probeStage.js";

const noBrowserNeeded = {
  durationSeconds: 5,
  unresolvedCompositionCount: 0,
  hasAutoStart: false,
  hasScriptedAudio: false,
  hasVariableMedia: false,
  hasInsertedMedia: false,
};

const config = (extra: Partial<RenderConfig>): RenderConfig => extra as RenderConfig;
const session = (checked: boolean | undefined): CaptureSession =>
  ({ strictVariablesChecked: checked }) as CaptureSession;

describe("probeRequiresBrowser", () => {
  it("needs a browser to check variables against the loaded page", () => {
    expect(probeRequiresBrowser(noBrowserNeeded)).toBe(false);
    expect(probeRequiresBrowser({ ...noBrowserNeeded, requiresVariablesCheck: true })).toBe(true);
  });
});

describe("strictVariablesAttestation", () => {
  it("says nothing when strict variables were not asked", () => {
    expect(strictVariablesAttestation(config({ variables: { a: 1 } }), null)).toBeUndefined();
    expect(strictVariablesAttestation(config({ strictVariables: false }), null)).toBeUndefined();
  });

  it("attests a pass when the probe session checked the page", () => {
    const asked = config({ strictVariables: true, variables: { a: 1 } });
    expect(strictVariablesAttestation(asked, session(true))).toBe(true);
  });

  it("does not attest when variables needed checking and no session checked them", () => {
    const asked = config({ strictVariables: true, variables: { a: 1 } });
    expect(strictVariablesAttestation(asked, null)).toBe(false);
    expect(strictVariablesAttestation(asked, session(undefined))).toBe(false);
  });

  it("attests when there are no variables, which have nothing to check", () => {
    expect(strictVariablesAttestation(config({ strictVariables: true }), null)).toBe(true);
    expect(strictVariablesAttestation(config({ strictVariables: true, variables: {} }), null)).toBe(
      true,
    );
  });
});
