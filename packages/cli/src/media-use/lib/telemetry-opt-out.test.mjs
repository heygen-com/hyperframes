import { strict as assert } from "node:assert";
import { test } from "node:test";
import { telemetryOptOutVariable } from "./telemetry-opt-out.mjs";

test("names the variable that turns telemetry off, the HyperFrames one first", () => {
  assert.equal(telemetryOptOutVariable({ DO_NOT_TRACK: "1" }), "DO_NOT_TRACK");
  assert.equal(
    telemetryOptOutVariable({ HYPERFRAMES_NO_TELEMETRY: "yes" }),
    "HYPERFRAMES_NO_TELEMETRY",
  );
  assert.equal(
    telemetryOptOutVariable({ DO_NOT_TRACK: "1", HYPERFRAMES_NO_TELEMETRY: "on" }),
    "HYPERFRAMES_NO_TELEMETRY",
  );
});

test("reads every affirmative spelling, and nothing else, as an opt-out", () => {
  for (const value of ["1", "true", "YES", " on "])
    assert.equal(telemetryOptOutVariable({ DO_NOT_TRACK: value }), "DO_NOT_TRACK", value);
  for (const value of ["", "0", "false", "no", "off"])
    assert.equal(telemetryOptOutVariable({ DO_NOT_TRACK: value }), null, value);
  assert.equal(telemetryOptOutVariable({}), null);
});
