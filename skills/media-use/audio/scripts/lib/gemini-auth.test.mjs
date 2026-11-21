import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonInvocation } from "./python.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiAuth, geminiConfigured } from "./gemini-auth.mjs";
import { loadEnvFromDir } from "./heygen.mjs";
import { pickProvider } from "./tts.mjs";

function env(t) {
  const saved = { ...process.env };
  for (const key of [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCS_CREDS",
  ])
    delete process.env[key];
  t.after(() => {
    process.env = saved;
  });
}

test("API keys take precedence over service accounts without invoking Python", (t) => {
  env(t);
  process.env.GEMINI_API_KEY = "gemini-key";
  process.env.GOOGLE_API_KEY = "google-key";
  process.env.GCS_CREDS = "private-json";
  const run = () => assert.fail("must not spawn Python");
  assert.deepEqual(geminiAuth({ run }).headers, { "x-goog-api-key": "gemini-key" });
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(geminiAuth({ run }).headers, { "x-goog-api-key": "google-key" });
});

// fails without the fix: a received project's Gemini key was used for speech with no note.
test("a received .env's Gemini key is used with one note naming the file", (t) => {
  env(t);
  delete process.env.HYPERFRAMES_PROJECT_ENV_ORIGINS;
  // Windows refuses control characters in folder names, so there the path is plain.
  const esc = process.platform === "win32" ? "" : String.fromCharCode(27);
  const project = mkdtempSync(join(tmpdir(), `hf-gemini-${esc}[31m-`));
  const write = process.stderr.write;
  const notes = [];
  t.after(() => {
    process.stderr.write = write;
    rmSync(project, { recursive: true, force: true });
  });
  writeFileSync(join(project, ".env"), "GEMINI_API_KEY=received\n");
  mkdirSync(join(project, ".hyperframes"));
  writeFileSync(
    join(project, ".hyperframes", "received-files.json"),
    JSON.stringify({ files: [".env"] }),
  );
  process.stderr.write = (line) => notes.push(String(line));
  loadEnvFromDir(project);
  const run = () => assert.fail("must not spawn Python");
  assert.deepEqual(geminiAuth({ run }).headers, { "x-goog-api-key": "received" });
  geminiAuth({ run });
  process.stderr.write = write;
  const shown = join(project, ".env").replace(esc || "\0", "\\x1b");
  assert.deepEqual(notes, [
    `[hyperframes] Using GEMINI_API_KEY from ${shown}, a received project: speech goes to that key's Gemini account.\n`,
  ]);
});

test("service-account configuration selects Gemini and returns scoped helper headers", (t) => {
  env(t);
  assert.equal(geminiConfigured(), false);
  assert.throws(() => geminiAuth(), /needs GEMINI_API_KEY/);
  for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "GCS_CREDS"]) {
    process.env[key] = "credential-source";
    assert.equal(pickProvider("gemini"), "gemini");
    const auth = geminiAuth({
      run: (_, args, options) => {
        assert.ok(args.at(-1).endsWith("gemini-auth.py"));
        assert.ok(!args.includes("credential-source"));
        assert.equal(options.timeout, 60000);
        return {
          status: 0,
          stdout: JSON.stringify({ token: "access-token", project: "quota-project" }),
        };
      },
    });
    assert.deepEqual(auth.headers, {
      Authorization: "Bearer access-token",
      "x-goog-user-project": "quota-project",
    });
    delete process.env[key];
  }
});

test("failed, malformed, or missing Python output cannot leak secrets or fall back", (t) => {
  env(t);
  process.env.GCS_CREDS = "private-json";
  for (const result of [
    { status: 1, stdout: '{"error":"private-json"}', stderr: "private-json" },
    { status: null, stdout: "private-json", error: new Error("private-json") },
    { status: 0, stdout: "{}" },
  ]) {
    assert.throws(
      () => geminiAuth({ run: () => result }),
      (error) => {
        assert.match(error.message, /authentication failed/);
        assert.ok(!error.message.includes("private-json"));
        return true;
      },
    );
  }
});

// Keep the Python credential-boundary suite reachable from the normal Node CI runner.
test("Python service-account boundary validates credentials, scope, transport and errors", () => {
  const { cmd, args } = pythonInvocation([
    fileURLToPath(new URL("./gemini-auth_test.py", import.meta.url)),
  ]);
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
