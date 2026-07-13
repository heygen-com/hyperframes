import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getProviders, getProvider, listTypes, runProviders, runCapability } from "./registry.mjs";

// --- registry shape -------------------------------------------------------

test("listTypes exposes the v2 media types", () => {
  const types = listTypes();
  for (const t of ["bgm", "sfx", "image", "icon", "logo", "voice", "brand", "grade", "lut"]) {
    assert.ok(types.includes(t), `missing type: ${t}`);
  }
});

test("heygen provider is first for every type it serves", () => {
  for (const t of ["bgm", "sfx", "image", "icon"]) {
    const first = getProviders(t)[0];
    assert.ok(first, `no enabled provider for ${t}`);
    assert.match(first.name, /^heygen/, `${t} first provider is ${first.name}`);
  }
});

test("sanctioned providers only: heygen, local mflux/kokoro, codex, design spec, logo tiers", () => {
  const allowed =
    /^heygen|^bundled\.sfx$|^mflux\.local$|^kokoro\.local$|^codex\.image_gen$|^design_spec$|^svgl$|^simple-icons$|^github\.avatar$|^favicon\.ddg$|^color_grade\.local$|^cube_lut\.local$/;
  for (const t of listTypes()) {
    for (const p of getProviders(t)) {
      assert.ok(allowed.test(p.name), `${t} lists unsanctioned provider: ${p.name}`);
    }
  }
});

test("image cascade: heygen catalog, then local mflux, then the codex upsell", () => {
  const ps = getProviders("image");
  assert.match(ps[0].name, /^heygen/, "heygen catalog first");
  const names = ps.map((p) => p.name);
  const mflux = ps.find((p) => p.name === "mflux.local");
  const codex = ps.find((p) => p.name === "codex.image_gen");
  assert.ok(mflux && typeof mflux.generate === "function", "local mflux registered");
  assert.ok(codex && typeof codex.generate === "function", "codex upsell registered");
  assert.ok(names.indexOf("mflux.local") < names.indexOf("codex.image_gen"), "local before codex");
  assert.ok(!mflux.network, "local mflux is kept under --local-only");
  assert.ok(codex.network, "codex is network (skipped under --local-only)");
});

test("voice cascade: HeyGen TTS first, Kokoro remains the local fallback", () => {
  const ps = getProviders("voice");
  assert.equal(ps[0].name, "heygen.tts", "HeyGen TTS is first when credentials exist");
  assert.ok(ps[0].network, "HeyGen TTS is network (skipped under --local-only)");
  assert.ok(ps[0].paid, "HeyGen TTS may bill after the OAuth free allowance");
  assert.equal(ps[1].name, "kokoro.local", "local Kokoro is the offline fallback");
  assert.ok(!ps[1].network, "local Kokoro kept under --local-only");
  assert.ok(!ps[1].paid, "local Kokoro is free");
});

test("sfx cascade: HeyGen catalog first, bundled library remains the local fallback", () => {
  const ps = getProviders("sfx");
  assert.equal(ps[0].name, "heygen.audio.sounds");
  assert.ok(ps[0].network, "HeyGen SFX catalog is network-only");
  assert.equal(ps[1].name, "bundled.sfx");
  assert.equal(typeof ps[1].search, "function");
  assert.ok(!ps[1].network, "bundled SFX remain available offline");
});

test("ctx.provider forces one generator (e.g. 'make an image WITH codex')", async () => {
  const providers = [
    { name: "heygen.asset.search", network: true, search: async () => null },
    { name: "mflux.local", generate: async () => ({ hit: "local" }) },
    { name: "codex.image_gen", network: true, generate: async () => ({ hit: "codex" }) },
  ];
  // no override: local wins (first generate to return non-null)
  assert.deepEqual(await runProviders(providers, "generate", "x", {}), { hit: "local" });
  // override to codex: skip local, use codex even though local would have worked
  assert.deepEqual(await runProviders(providers, "generate", "x", { provider: "codex" }), {
    hit: "codex",
  });
  // override matches the full name too
  assert.deepEqual(
    await runProviders(providers, "generate", "x", { provider: "codex.image_gen" }),
    { hit: "codex" },
  );
  // --local-only wins even over a forced network provider: no network call,
  // clean miss (the caller surfaces the conflict). A forced LOCAL provider under
  // --local-only still runs.
  assert.equal(
    await runProviders(providers, "generate", "x", { provider: "codex", localOnly: true }),
    null,
  );
  assert.deepEqual(
    await runProviders(providers, "generate", "x", { provider: "mflux", localOnly: true }),
    { hit: "local" },
  );
});

test("getProvider returns the first provider with its type, throws for unknown", () => {
  const p = getProvider("bgm");
  assert.equal(p.type, "bgm");
  assert.equal(typeof p.search, "function");
  assert.throws(() => getProvider("unknown_type"), /unknown media type/);
});

test("getProviders throws for unknown type", () => {
  assert.throws(() => getProviders("nope"), /unknown media type/);
});

// --- deterministic capability execution (runProviders core) ---------------

test("runProviders calls providers in order and returns the first non-null", async () => {
  const calls = [];
  const providers = [
    {
      name: "a",
      enabled: true,
      search: async () => {
        calls.push("a");
        return null;
      },
    },
    {
      name: "b",
      enabled: true,
      search: async () => {
        calls.push("b");
        return { hit: "b" };
      },
    },
    {
      name: "c",
      enabled: true,
      search: async () => {
        calls.push("c");
        return { hit: "c" };
      },
    },
  ];
  const res = await runProviders(providers, "search", "x", {});
  assert.deepEqual(res, { hit: "b" });
  assert.deepEqual(calls, ["a", "b"], "must stop at first non-null, never call c");
});

test("runProviders skips providers missing the requested capability", async () => {
  const providers = [
    { name: "a", enabled: true /* no search */ },
    { name: "b", enabled: true, search: async () => ({ hit: "b" }) },
  ];
  const res = await runProviders(providers, "search", "x", {});
  assert.deepEqual(res, { hit: "b" });
});

test("runProviders returns null when no provider yields a result", async () => {
  const providers = [{ name: "a", enabled: true, search: async () => null }];
  assert.equal(await runProviders(providers, "search", "x", {}), null);
});

test("runCapability('bgm','process') is null — process slot is graceful when unfilled", async () => {
  assert.equal(await runCapability("bgm", "process", "x", {}), null);
});

test("--local-only skips every network provider (even free remote ones)", async () => {
  let remoteRan = false;
  const providers = [
    {
      name: "heygen",
      network: true,
      search: async () => {
        remoteRan = true;
        return { hit: "net" };
      },
    },
    { name: "local", search: async () => ({ hit: "local" }) },
  ];
  assert.deepEqual(await runProviders(providers, "search", "x", { localOnly: true }), {
    hit: "local",
  });
  assert.equal(remoteRan, false, "the remote provider must not be called offline");
});
