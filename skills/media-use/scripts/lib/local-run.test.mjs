import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runLocalModel } from "./local-run.mjs";

const strongCpu = { ramMB: 16000, gpu: { present: false, vramMB: 0 }, appleSilicon: false };
const tiny = { ramMB: 512, gpu: { present: false, vramMB: 0 }, appleSilicon: false };
const ok = () => {}; // which/exec that succeed

test("recommends the CLI path when no local tier fits the machine", () => {
  const r = runLocalModel("tts", { specs: tiny, which: ok, exec: ok });
  assert.equal(r.recommend, "cli");
});

test("recommends install when the tool is not on PATH", () => {
  const r = runLocalModel("tts", {
    specs: strongCpu,
    which: () => {
      throw new Error("not found");
    },
    exec: ok,
    vars: { text: "hi", out: "/tmp/v.wav" },
  });
  assert.equal(r.recommend, "install");
  assert.equal(r.model, "kokoro");
  assert.match(r.command, /pip install kokoro/);
});

test("runs the model and returns the output path when installed", () => {
  let ran = "";
  const r = runLocalModel("tts", {
    specs: strongCpu,
    which: ok,
    exec: (cmd) => {
      ran = cmd;
    },
    vars: { text: "hello world", voice: "af_heart", out: "/tmp/v.wav" },
  });
  assert.equal(r.model, "kokoro");
  assert.equal(r.out, "/tmp/v.wav");
  assert.match(ran, /hello world/, "invoke template filled with vars");
  assert.match(ran, /\/tmp\/v\.wav/);
});

test("a failing run degrades to an install recommendation, never throws", () => {
  const r = runLocalModel("upscale", {
    specs: strongCpu,
    which: ok,
    exec: () => {
      throw new Error("boom");
    },
    vars: { in: "a.png", out: "b.png" },
  });
  assert.equal(r.recommend, "install");
});

test("a tier whose tool is missing demotes to the next tier that fits", () => {
  // 64GB + GPU fits BOTH tts tiers, so the ladder has two rungs: fish-speech
  // (its own binary) above Kokoro (`python -m kokoro`). fish-speech absent must
  // not cost the user Kokoro.
  const strongGpu = { ramMB: 64000, gpu: { present: true, vramMB: 24000 } };
  let ran = "";
  const r = runLocalModel("tts", {
    specs: strongGpu,
    which: (bin) => {
      if (bin === "fish-speech") throw new Error("not found");
    },
    exec: (cmd) => {
      ran = cmd;
    },
    vars: { text: "hello", voice: "af_heart", out: "/tmp/v.wav" },
  });

  assert.equal(r.model, "kokoro", "demoted past the missing fish-speech binary");
  assert.equal(r.tier, "medium");
  assert.match(ran, /kokoro/);
});

test("every fitting tier failing reports the last tier's install command", () => {
  const strongGpu = { ramMB: 64000, gpu: { present: true, vramMB: 24000 } };
  const r = runLocalModel("tts", {
    specs: strongGpu,
    which: ok,
    exec: () => {
      throw new Error("boom");
    },
    vars: { text: "hi", out: "/tmp/v.wav" },
  });

  assert.equal(r.recommend, "install");
  assert.equal(r.model, "kokoro", "the smallest fitting tier is the actionable one");
});

test("the install recommendation states the download size", () => {
  // nothing today tells the user what they are agreeing to before a tool
  // starts pulling weights, so the size travels in the payload AND in the
  // text a caller shows them
  const r = runLocalModel("tts", {
    specs: strongCpu,
    which: () => {
      throw new Error("not found");
    },
  });

  assert.equal(r.recommend, "install");
  assert.equal(typeof r.sizeMB, "number");
  assert.ok(r.sizeMB > 0);
  assert.match(r.reason, /GB to download/);
});

test("a failed run still reports the tier's size", () => {
  const r = runLocalModel("tts", {
    specs: strongCpu,
    which: ok,
    exec: () => {
      throw new Error("boom");
    },
  });

  assert.equal(r.recommend, "install");
  assert.equal(typeof r.sizeMB, "number");
});
