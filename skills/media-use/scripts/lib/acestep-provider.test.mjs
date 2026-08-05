import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateWithAceStep } from "./acestep-provider.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("ACE-Step submits, polls, and resolves a generated audio URL", async () => {
  const calls = [];
  const responses = [
    json({ data: { task_id: "task-1" } }),
    json({ data: [{ task_id: "task-1", status: 0, result: "" }] }),
    json({
      data: [
        {
          task_id: "task-1",
          status: 1,
          result: JSON.stringify([
            {
              file: "/v1/audio?path=track.mp3",
              metas: { duration: 42 },
              dit_model: "xl",
              lm_model: "4b",
            },
          ]),
        },
      ],
    }),
  ];
  let clock = 0;
  const result = await generateWithAceStep(
    "cinematic pulse",
    { duration: 42 },
    {
      config: { baseUrl: "https://music.example", apiKey: "secret" },
      fetch: async (url, options) => {
        calls.push({ url, options });
        return responses.shift();
      },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    },
  );
  assert.equal(result.url, "https://music.example/v1/audio?path=track.mp3");
  assert.equal(result.metadata.provider, "acestep.remote");
  assert.equal(result.metadata.duration, 42);
  assert.deepEqual(result.downloadHeaders, { authorization: "Bearer secret" });
  assert.equal(calls.length, 3);
  assert.match(calls[0].options.body, /acestep-v15-sft/);
  assert.match(calls[0].options.body, /"lm_backend":"pt"/);
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
});

test("ACE-Step is unavailable when it has no configured endpoint", async () => {
  assert.equal(await generateWithAceStep("x", {}, { config: { baseUrl: "", apiKey: "" } }), null);
});

test("ACE-Step surfaces failed jobs", async () => {
  const responses = [
    json({ data: { task_id: "bad" } }),
    json({ data: [{ status: 2, error: "out of memory" }] }),
  ];
  await assert.rejects(
    generateWithAceStep(
      "x",
      {},
      {
        config: { baseUrl: "https://music.example", apiKey: "" },
        fetch: async () => responses.shift(),
      },
    ),
    /out of memory/,
  );
});
