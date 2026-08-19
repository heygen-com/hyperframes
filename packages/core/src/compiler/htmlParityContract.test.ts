import { describe, expect, it } from "vitest";
import { extractCompiledHtmlParityContract } from "./htmlParityContract";

describe("extractCompiledHtmlParityContract", () => {
  it("normalizes legacy timing and nested variable JSON", () => {
    const contract = extractCompiledHtmlParityContract(`<main data-composition-id="main"
      data-variable-values='{"z":{"b":2,"a":1},"a":[{"d":4,"c":3}]}' data-start="1" data-end="4" data-layer="2">
      <div id="child" data-start="2" data-end="3" data-layer="5"></div>
    </main>`);
    expect(contract.compositions[0]).toMatchObject({
      start: 1,
      duration: 3,
      trackIndex: 2,
      variableValues: '{"a":[{"c":3,"d":4}],"z":{"a":1,"b":2}}',
    });
    expect(contract.timedElements[0]).toMatchObject({ start: 2, duration: 1, trackIndex: 5 });
  });

  it("treats embedded and project-relative resources as the same local contract", () => {
    const embedded = extractCompiledHtmlParityContract(
      `<img id="logo" src="data:image/svg+xml,x" />`,
    );
    const project = extractCompiledHtmlParityContract(`<img id="logo" src="assets/logo.svg" />`);
    expect(embedded.resources).toEqual(project.resources);
  });
});
