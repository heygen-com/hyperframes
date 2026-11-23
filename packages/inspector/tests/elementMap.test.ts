import { test } from "vitest";
import assert from "node:assert/strict";
import { collectElementDom, formatElementMap } from "../src/elementMap.js";
import { Window } from "happy-dom";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAuthoredState } from "../src/authoredState";
import { authoredHtml } from "../src/sources";

function collect(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.eval(`(${collectElementDom.toString()})()`) as ReturnType<typeof collectElementDom>;
}

function map(html: string) {
  return formatElementMap(collect(html));
}

test("preserves every included element and groups exact repeated siblings", () => {
  const result = map(
    '<div id="scene"><i class="particle"></i><i class="particle"></i><p>Hello</p></div>',
  );
  assert.equal(result.elementCount, 5);
  assert.equal(result.coveredCount, 5);
  assert.match(result.text, /i\.particle ×2/);
  assert.equal(result.entries.flatMap((entry) => entry.selectors).length, 5);
});

test("keeps hidden elements, wrappers, text, media, and scope", () => {
  const result = map(
    '<section data-composition-id="intro"><div hidden><img src="logo.svg"><p> Hello\n world </p></div></section>',
  );
  assert.match(result.text, /composition="intro"/);
  assert.match(result.text, /src="logo.svg"/);
  assert.match(result.text, /"Hello world"/);
  assert.equal(result.coveredCount, 5);
});

test("style changes produce no map churn and script/style bodies are omitted", () => {
  const before =
    '<div id="orb" style="color:red"></div><script>secret()</script><style>.orb{}</style>';
  assert.equal(map(before).text, map(before.replace("color:red", "color:blue")).text);
  assert.doesNotMatch(map(before).text, /secret|color|style/);
});

test("duplicate IDs and escaped selectors resolve uniquely", () => {
  const snapshot = collect(
    '<div id="same"></div><div id="same"></div><i id="a:b"></i><b class="x:y"></b>',
  );
  assert.equal(new Set(snapshot.nodes.map((node) => node.selector)).size, 5);
  assert.match(snapshot.nodes[3].selector, /\\:/);
});

test("does not group a subset under an overbroad selector", () => {
  const result = map('<i class="dot">A</i><i class="dot">A</i><i class="dot">B</i>');
  assert.doesNotMatch(result.text, /×2/);
});

test("a class superset prevents grouping under an overbroad class selector", () => {
  const result = map('<i class="dot">A</i><i class="dot">A</i><i class="dot accent">A</i>');
  assert.doesNotMatch(result.text, /×2/);
  assert.equal(result.coveredCount, 4);
});

test("grouped subtrees retain descendants and scoped positions", () => {
  const result = map('<div class="card"><i>A</i><i>B</i></div>'.repeat(3));
  assert.equal(result.coveredCount, 10);
  assert.match(result.text, /i:nth-child\(1\) ×3 "A"/);
  assert.match(result.text, /i:nth-child\(2\) ×3 "B"/);
});

test("deterministic and does not mutate captured data", () => {
  const snapshot = collect('<div class="b a">"hello"</div>');
  const original = JSON.stringify(snapshot);
  assert.deepEqual(formatElementMap(snapshot), formatElementMap(snapshot));
  assert.equal(JSON.stringify(snapshot), original);
});

test("explicitly reports unrepresented embedded surfaces", () => {
  assert.match(map("<canvas></canvas><iframe></iframe>").text, /canvas=1, iframe=1/);
});

test("deep nesting does not exponentially serialize child signatures", () => {
  const result = map("<div>".repeat(100) + "Deep" + "</div>".repeat(100));
  assert.equal(result.elementCount, 101);
  assert.equal(result.coveredCount, 101);
});

test("embedded media uses a deterministic identifier instead of its payload", () => {
  const first = map('<img src="data:image/png;base64,' + "A".repeat(20000) + '">');
  const second = map('<img src="data:image/png;base64,' + "B".repeat(20000) + '">');
  assert(first.text.length < 200);
  assert.match(first.text, /data:image\/png#sha256:[a-f0-9]{16}/);
  assert.notEqual(first.text, second.text);
});

test("blob URLs identify runtime media without claiming a persistent asset identity", () => {
  assert.equal(
    map('<img src="blob:https://example.com/one">').text,
    map('<img src="blob:https://example.com/two">').text,
  );
  assert.match(map('<img src="blob:https://example.com/one">').text, /blob:runtime/);
});

test("classes and text the timeline sets at the current frame do not change the map", () => {
  const authored =
    '<div id="s"><i data-hf-id="hf-a" class="ch">0.0</i><i data-hf-id="hf-b" class="ch">0.0</i><i data-hf-id="hf-c" class="ch">0.0</i></div>';
  const playing = authored
    .replace('class="ch">0.0</i><i data-hf-id="hf-b"', 'class="ch on">5.2</i><i data-hf-id="hf-b"')
    .replace('"hf-c" class="ch">0.0', '"hf-c" class="ch on cur">5.2');
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), authored);
    const sources = authoredHtml(dir);
    const atRest = formatElementMap(withAuthoredState(collect(authored), sources)).text;
    assert.match(atRest, /i\.ch ×3 @1-3 "0\.0"/);
    assert.equal(formatElementMap(withAuthoredState(collect(playing), sources)).text, atRest);
    assert.notEqual(map(playing).text, atRest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("script-built letters inside a source text stay one stable line", () => {
  const authored =
    '<span id="a-type" data-hf-id="hf-t" class="a-type">Hi</span><b id="km" data-hf-id="hf-k">0.0</b>';
  const playing = (on: boolean) =>
    `<span id="a-type" data-hf-id="hf-t" class="a-type"><span class="a-ch${on ? " on" : ""}">H</span><span class="a-ch${on ? " on cur" : ""}">i</span></span><b id="km" data-hf-id="hf-k">${on ? "5.2" : "0.0"}</b>`;
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), authored);
    const sources = authoredHtml(dir);
    const early = formatElementMap(withAuthoredState(collect(playing(false)), sources)).text;
    const later = formatElementMap(withAuthoredState(collect(playing(true)), sources)).text;
    assert.equal(early, later);
    assert.match(early, /#a-type[^\n]*"Hi"/);
    assert.match(early, /span ×2 @1-2 \(generated\)/);
    assert.match(early, /"0\.0"/);
    assert.doesNotMatch(early, /a-ch|5\.2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty source element keeps the elements a script appended", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), '<div id="box" data-hf-id="hf-b"></div>');
    const text = formatElementMap(
      withAuthoredState(
        collect('<div id="box" data-hf-id="hf-b"><i class="e-p"></i><i class="e-p"></i></div>'),
        authoredHtml(dir),
      ),
    ).text;
    assert.match(text, /i\.e-p ×2/);
    assert.doesNotMatch(text, /generated/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("class names stay in source order", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), '<i data-hf-id="hf-a" class="word light">x</i>');
    const text = formatElementMap(
      withAuthoredState(
        collect('<i data-hf-id="hf-a" class="word light">x</i>'),
        authoredHtml(dir),
      ),
    ).text;
    assert.match(text, /i\.word\.light/);
    assert.doesNotMatch(text, /i\.light\.word/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an id the runtime removed stays visible without becoming the selector", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), '<div id="root" data-hf-id="hf-r"></div>');
    const text = formatElementMap(
      withAuthoredState(collect('<div data-hf-id="hf-r"></div>'), authoredHtml(dir)),
    ).text;
    assert.match(text, /id="root"/);
    assert.doesNotMatch(text, /#root/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unquoted authored class stays on the map", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(
      join(dir, "index.html"),
      '<div id="counter" data-hf-id="hf-c" class=card>0.0</div>',
    );
    const text = formatElementMap(
      withAuthoredState(
        collect('<div id="counter" data-hf-id="hf-c" class="card">5.2</div>'),
        authoredHtml(dir),
      ),
    ).text;
    assert.match(text, /card/);
    assert.match(text, /"0\.0"/);
    assert.doesNotMatch(text, /5\.2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty source element keeps its text empty while a script fills it", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), '<span id="n" data-hf-id="hf-n"></span>');
    const sources = authoredHtml(dir);
    const at = (value: string) =>
      formatElementMap(
        withAuthoredState(collect(`<span id="n" data-hf-id="hf-n">${value}</span>`), sources),
      ).text;
    assert.equal(at("0.0"), at("5.2"));
    assert.doesNotMatch(at("5.2"), /0\.0|5\.2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mixed source text and entities stay on the authored words", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(
      join(dir, "index.html"),
      '<span id="n" data-hf-id="hf-n"><b data-hf-id="hf-b">Go</b> 0.0</span><span id="amp" data-hf-id="hf-a">A &amp; B</span>',
    );
    const sources = authoredHtml(dir);
    const playing = formatElementMap(
      withAuthoredState(
        collect(
          '<span id="n" data-hf-id="hf-n"><b data-hf-id="hf-b">Go</b> 5.2</span><span id="amp" data-hf-id="hf-a">A &amp; C</span>',
        ),
        sources,
      ),
    ).text;
    assert.match(playing, /#n[^\n]*"0\.0"/);
    assert.match(playing, /"Go"/);
    assert.match(playing, /#amp[^\n]*"A & B"/);
    assert.doesNotMatch(playing, /5\.2|A & C/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an element whose live classes drop an authored one keeps its live state", () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  try {
    writeFileSync(join(dir, "index.html"), '<p data-hf-id="hf-a" class="hidden">x</p>');
    const live = withAuthoredState(
      collect('<p data-hf-id="hf-a" class="shown">x</p>'),
      authoredHtml(dir),
    );
    assert.equal(live.nodes.at(-1)?.classes.join(" "), "shown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
