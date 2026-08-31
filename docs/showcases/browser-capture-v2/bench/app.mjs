import {
  buildWebCaptureText,
  parseWebCaptureText,
} from "/core/webCaptureContract.js";

const PNG_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_SHA256 = "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";
const CORRUPT_PNG_DATA = "iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB";
const CORRUPT_PNG_SHA256 =
  "82233833031b185813af84278169c2c5c553091bbc6fac4a0a57446a18dd46f6";
const WOFF2_MAX_EXPANSION_DATA =
  "d09GMgAAAAAAAAAwAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const WOFF2_MAX_EXPANSION_SHA256 =
  "a29190d9f719369ea855febcf74e92e79129c713fa5e4e5c00c059bab9aee784";

const CASES = [
  {
    id: "valid-round-trip",
    number: "A1",
    tone: "#72f1b8",
    title: "A real PNG survives both sides",
    description:
      "The producer builds canonical bytes, the consumer parses them again, and browser image decoding independently confirms the resource.",
    expected: "ok · editable-dom",
  },
  {
    id: "late-bad-sha",
    number: "B7",
    tone: "#ffcf70",
    title: "A late bad SHA stops the whole batch",
    description:
      "Resource two is dishonest. Resource one still never reaches the decoder because the full batch must pass preflight first.",
    expected: "resource.hash-mismatch · 0 decoder calls",
  },
  {
    id: "font-expansion",
    number: "C4",
    tone: "#be8cff",
    title: "Shipping weight cannot hide warehouse volume",
    description:
      "A tiny WOFF2 header claims an enormous decoded font. The expanded cost is rejected before any allocation or decoder call.",
    expected: "budget.decoded-font-bytes · 0 decoder calls",
  },
  {
    id: "corrupt-png",
    number: "D2",
    tone: "#ff7b88",
    title: "A perfect-looking header is not a picture",
    description:
      "Static PNG metadata passes, then the real browser decoder refuses the truncated bytes and the contract returns a closed failure.",
    expected: "resource.invalid-data · browser decoder called",
  },
  {
    id: "hung-decoder",
    number: "E9",
    tone: "#72a7ff",
    title: "A decoder that never answers still finishes",
    description:
      "The materializer stalls forever. One shared deadline aborts the exact signal it received and returns a tagged outcome.",
    expected: "resource.materialization-aborted · signal observed",
  },
];

const byId = new Map(CASES.map((item) => [item.id, item]));
const caseList = document.querySelector("#case-list");
const detail = document.querySelector("#case-detail");
const title = document.querySelector("#title");
const kicker = document.querySelector("#kicker");
const description = document.querySelector("#description");
const expected = document.querySelector("#expected");
const consoleNode = document.querySelector("#console");
const callsNode = document.querySelector("#calls");
const meterSub = document.querySelector("#meter-sub");
const runButton = document.querySelector("#run-case");

let selected = CASES[0];

function imageResource(id, overrides = {}) {
  return {
    id,
    kind: "image",
    mime: "image/png",
    bytes: 68,
    sha256: PNG_SHA256,
    data: PNG_DATA,
    width: 1,
    height: 1,
    ...overrides,
  };
}

function editableInput(resources = []) {
  return {
    artifact: {
      kind: "editable-dom",
      html: '<section class="capture-proof">Hard case proof</section>',
      css: ".capture-proof{font:700 24px system-ui;color:#72f1b8}",
      width: 640,
      height: 360,
    },
    resources,
    diagnostics: [],
    claims: {
      sourceFrame: { width: 640, height: 360, devicePixelRatio: 2 },
      time: { kind: "locked-frame", atMs: 0 },
      reflow: "fixed-viewport",
    },
  };
}

function resetStages() {
  for (const stage of document.querySelectorAll("[data-stage]")) stage.dataset.state = "idle";
}

function stage(name, state) {
  document.querySelector(`[data-stage="${name}"]`).dataset.state = state;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function materializeBrowserImage(bytes, inspected, signal, tracker) {
  tracker.calls += 1;
  tracker.decoder = "createImageBitmap";
  if (signal.aborted) throw new DOMException("capture cancelled", "AbortError");
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: inspected.mime }));
    const result = { mime: inspected.mime, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch {
    return null;
  }
}

async function executeCase(caseId) {
  const tracker = { calls: 0, decoder: "none", abortObserved: false };
  const browserImageMaterializer = (bytes, inspected, signal) =>
    materializeBrowserImage(bytes, inspected, signal, tracker);
  let result;
  let input;

  if (caseId === "valid-round-trip") {
    input = editableInput([imageResource("image-1")]);
    const built = await buildWebCaptureText(input, {
      materializeResource: browserImageMaterializer,
    });
    result = built;
    if (built.ok) {
      const parsed = await parseWebCaptureText(built.text, {
        materializeResource: browserImageMaterializer,
      });
      result = parsed.ok
        ? {
            ok: true,
            artifactKind: parsed.envelope.artifact.kind,
            version: parsed.envelope.version,
            canonicalUtf8Bytes: new TextEncoder().encode(parsed.canonicalText).byteLength,
          }
        : parsed;
    }
  } else if (caseId === "late-bad-sha") {
    input = editableInput([
      imageResource("image-1"),
      imageResource("image-2", { sha256: "0".repeat(64) }),
    ]);
    result = await buildWebCaptureText(input, {
      materializeResource: browserImageMaterializer,
    });
  } else if (caseId === "font-expansion") {
    input = editableInput([
      {
        id: "font-1",
        kind: "font",
        mime: "font/woff2",
        bytes: 48,
        decodedBytes: 0xffffffff,
        sha256: WOFF2_MAX_EXPANSION_SHA256,
        data: WOFF2_MAX_EXPANSION_DATA,
      },
    ]);
    result = await buildWebCaptureText(input, {
      materializeResource: browserImageMaterializer,
    });
  } else if (caseId === "corrupt-png") {
    input = editableInput([
      imageResource("image-1", {
        bytes: 24,
        sha256: CORRUPT_PNG_SHA256,
        data: CORRUPT_PNG_DATA,
      }),
    ]);
    result = await buildWebCaptureText(input, {
      materializeResource: browserImageMaterializer,
    });
  } else if (caseId === "hung-decoder") {
    input = editableInput([imageResource("image-1")]);
    result = await buildWebCaptureText(input, {
      materializeResource: async (_bytes, _inspected, signal) => {
        tracker.calls += 1;
        tracker.decoder = "intentionally stalled test capability";
        signal.addEventListener(
          "abort",
          () => {
            tracker.abortObserved = signal.aborted;
          },
          { once: true },
        );
        return new Promise(() => undefined);
      },
    });
  } else {
    throw new Error(`Unknown hard case: ${caseId}`);
  }

  return {
    caseId,
    result,
    materializerCalls: tracker.calls,
    decoder: tracker.decoder,
    abortObserved: tracker.abortObserved,
    sourceResourceCount: input.resources.length,
  };
}

async function persistEvidence(evidence) {
  const response = await fetch(`/evidence/${evidence.caseId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(evidence),
  });
  if (!response.ok) throw new Error(`Evidence write failed: ${response.status}`);
  return response.json();
}

function renderCaseList() {
  caseList.replaceChildren(
    ...CASES.map((item) => {
      const button = document.createElement("button");
      button.className = "case";
      button.dataset.case = item.id;
      button.style.setProperty("--tone", item.tone);
      button.ariaCurrent = String(item.id === selected.id);
      button.innerHTML = `<span class="case-id">${item.number}</span><span><span class="case-name">${item.title}</span><span class="case-rule">${item.expected}</span></span><span class="case-state">○</span>`;
      button.addEventListener("click", () => selectCase(item.id));
      return button;
    }),
  );
}

function selectCase(caseId) {
  selected = byId.get(caseId) ?? CASES[0];
  detail.style.setProperty("--tone", selected.tone);
  detail.dataset.runState = "idle";
  kicker.textContent = `${selected.number} · adversarial witness`;
  title.textContent = selected.title;
  description.textContent = selected.description;
  expected.textContent = selected.expected;
  consoleNode.textContent = "ready\nrun the case against the real browser package";
  callsNode.textContent = "0";
  meterSub.textContent = "nothing decoded yet";
  runButton.disabled = false;
  runButton.textContent = "Run hard case";
  resetStages();
  renderCaseList();
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  runButton.textContent = "Running…";
  detail.dataset.runState = "running";
  resetStages();
  stage("envelope", "active");
  consoleNode.textContent = `case ${selected.id}\nroute hyperframes-web-capture\nchecking canonical envelope…`;
  await sleep(520);
  stage("envelope", "pass");
  stage("preflight", "active");
  consoleNode.textContent += "\nchecking quotas, static bytes, and every SHA…";
  await sleep(520);

  const evidence = await executeCase(selected.id);
  stage("preflight", evidence.materializerCalls > 0 || evidence.result.ok ? "pass" : "fail");
  stage("materialize", evidence.materializerCalls > 0 ? "active" : "skip");
  callsNode.textContent = String(evidence.materializerCalls);
  meterSub.textContent = evidence.decoder;
  if (evidence.materializerCalls > 0) await sleep(620);
  stage("materialize", evidence.materializerCalls > 0 ? "pass" : "skip");
  stage("result", "pass");

  const persisted = await persistEvidence(evidence);
  consoleNode.textContent = JSON.stringify(
    {
      result: evidence.result,
      materializerCalls: evidence.materializerCalls,
      abortObserved: evidence.abortObserved,
      evidenceFile: persisted.path,
    },
    null,
    2,
  );
  const selectedButton = document.querySelector(`[data-case="${selected.id}"]`);
  selectedButton.dataset.complete = "true";
  selectedButton.querySelector(".case-state").textContent = "●";
  runButton.textContent = "Evidence persisted";
  detail.dataset.runState = "done";
});

const requested = new URLSearchParams(location.search).get("case");
selectCase(requested ?? CASES[0].id);

window.__captureBench = { executeCase };
