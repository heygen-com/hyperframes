import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("product launch capture treats blocked output as a hard gate", () => {
  const skill = read("../SKILL.md");

  assert.match(skill, /hyperframes capture[^\n]+--json/);
  assert.match(skill, /capture\/BLOCKED\.md[^\n]+hard stop/i);
  assert.match(skill, /do not[\s\S]{0,120}synthetic[\s\S]{0,120}fallback/i);
  assert.match(skill, /very little text[\s\S]{0,180}empty asset/i);
  assert.match(skill, /show-it-as-is[\s\S]{0,240}provided screenshot/i);
});

test("CLI capture reference documents the two budgets and machine diagnostics", () => {
  const reference = read("../../hyperframes-cli/references/init-and-scaffold.md");

  assert.match(reference, /--capture-budget/);
  assert.match(reference, /--skip-vision/);
  assert.match(reference, /HYPERFRAMES_CAPTURE_PHASE/);
  assert.match(reference, /BLOCKED\.md[^\n]+hard stop/i);
  assert.match(reference, /--timeout[^\n]+navigation[^\n]+--capture-budget/i);
  assert.match(reference, /fresh output directory/i);
  assert.match(reference, /outer caller timeout[\s\S]{0,180}does not prove/i);
});

test("webpage motion workflow refuses blocked capture artifacts", () => {
  const module = read("../../motion-graphics/categories/webpage/module.md");

  assert.match(module, /BLOCKED\.md[\s\S]{0,120}stop/i);
  assert.match(module, /provided[\s\S]{0,120}screenshot[\s\S]{0,120}explicit/i);
  assert.match(module, /do not[^\n]+blocked[^\n]+capture/i);
  assert.match(module, /asset-free fallback/i);
});
