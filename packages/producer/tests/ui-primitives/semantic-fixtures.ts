export type OperatorBlackTheme = "dark" | "light";

export type SemanticFixtureState = "open" | "closed";

export type SemanticStateFixtureSpec =
  | {
      id: string;
      mode: "controlled";
      controller: string;
      relationship: "aria-controls" | "aria-describedby";
      stateOwner?: string;
    }
  | {
      id: string;
      mode: "root";
    };

export const CLOSED_STATE_FIXTURES = [
  {
    id: "accordion",
    mode: "controlled",
    controller: ".hf-ui-accordion-trigger",
    relationship: "aria-controls",
    stateOwner: ".hf-ui-accordion-item",
  },
  { id: "alert-dialog", mode: "root" },
  { id: "backdrop", mode: "root" },
  {
    id: "collapsible",
    mode: "controlled",
    controller: ".hf-ui-collapsible button",
    relationship: "aria-controls",
  },
  {
    id: "combobox",
    mode: "controlled",
    controller: ".hf-ui-combobox-trigger",
    relationship: "aria-controls",
  },
  { id: "context-menu", mode: "root" },
  { id: "dialog", mode: "root" },
  { id: "drawer", mode: "root" },
  {
    id: "dropdown-menu",
    mode: "controlled",
    controller: ".hf-ui-dropdown-trigger",
    relationship: "aria-controls",
  },
  {
    id: "hover-card",
    mode: "controlled",
    controller: ".hf-ui-hover-card button",
    relationship: "aria-controls",
  },
  {
    id: "popover",
    mode: "controlled",
    controller: ".hf-ui-popover-anchor",
    relationship: "aria-controls",
  },
  {
    id: "select",
    mode: "controlled",
    controller: ".hf-ui-select-trigger",
    relationship: "aria-controls",
  },
  { id: "sheet", mode: "root" },
  { id: "toast", mode: "root" },
  {
    id: "tooltip",
    mode: "controlled",
    controller: ".hf-ui-tooltip-trigger",
    relationship: "aria-describedby",
  },
] as const satisfies readonly SemanticStateFixtureSpec[];

export interface StandaloneFixtureOptions {
  id: string;
  theme: OperatorBlackTheme;
}

export interface DemoFixtureOptions extends StandaloneFixtureOptions {
  gsapSource: string;
}

export interface SemanticStateFixtureOptions extends StandaloneFixtureOptions {
  spec: SemanticStateFixtureSpec;
  state: SemanticFixtureState;
}

const CANONICAL_START = "<!-- hf-ui:canonical:start -->";
const CANONICAL_END = "<!-- hf-ui:canonical:end -->";

function markerCount(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function escapeInlineScript(source: string): string {
  return source.replaceAll("</script", "<\\/script");
}

export function extractCanonicalRegion(demoHtml: string): string {
  const startCount = markerCount(demoHtml, CANONICAL_START);
  const endCount = markerCount(demoHtml, CANONICAL_END);
  if (startCount === 0 || endCount === 0) {
    throw new Error("demo must contain canonical markers");
  }
  if (startCount !== 1 || endCount !== 1) {
    throw new Error("demo must contain exactly one canonical marker pair");
  }

  const start = demoHtml.indexOf(CANONICAL_START) + CANONICAL_START.length;
  const end = demoHtml.indexOf(CANONICAL_END);
  if (end <= start) throw new Error("canonical markers are out of order");
  return demoHtml.slice(start, end).trim();
}

export function createStandaloneFixture(
  canonicalHtml: string,
  options: StandaloneFixtureOptions,
): string {
  const canvas = options.theme === "light" ? "#f6f5f1" : "#0a0a0a";
  return `<!doctype html>
<html lang="en" data-hf-verifier-fixture="canonical">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.id} canonical verification fixture</title>
    <style>
      html,
      body {
        box-sizing: border-box;
        margin: 0;
        width: 100%;
        min-height: 100%;
      }
      body {
        display: grid;
        place-items: center;
        padding: clamp(8px, 4vw, 64px);
        overflow: auto;
        background: ${canvas};
      }
      .hf-ui-verifier-stage {
        display: grid;
        place-items: center;
        width: 100%;
        min-width: 0;
      }
    </style>
  </head>
  <body data-hf-theme="${options.theme}">
    <main class="hf-ui-verifier-stage" data-hf-verifier-id="${options.id}">
${canonicalHtml}
    </main>
  </body>
</html>`;
}

export function createSemanticStateFixture(
  canonicalHtml: string,
  options: SemanticStateFixtureOptions,
): string {
  if (options.id !== options.spec.id) {
    throw new Error(`semantic fixture ID ${options.id} does not match ${options.spec.id}`);
  }
  const fixture = createStandaloneFixture(canonicalHtml, options);
  const config = JSON.stringify({ spec: options.spec, state: options.state });
  const stateScript = `<script data-hf-verifier-semantic-state>
    (() => {
      const config = ${config};
      const root = document.querySelector("[data-hf-ui-root]");
      if (!(root instanceof HTMLElement)) throw new Error("semantic fixture has no root");
      const open = config.state === "open";
      root.dataset.state = config.state;

      if (config.spec.mode === "root") {
        root.dataset.hfSemanticRegion = "true";
        root.hidden = !open;
        root.inert = !open;
        if (open) root.removeAttribute("aria-hidden");
        else root.setAttribute("aria-hidden", "true");
        return;
      }

      const controller = root.querySelector(config.spec.controller);
      if (!(controller instanceof HTMLElement)) {
        throw new Error("missing semantic controller " + config.spec.controller);
      }
      const relationship = controller.getAttribute(config.spec.relationship);
      const relationshipIds = relationship?.trim().split(/\\s+/).filter(Boolean) ?? [];
      if (relationshipIds.length !== 1) {
        throw new Error(
          config.spec.controller + " must reference exactly one semantic region via " +
            config.spec.relationship,
        );
      }
      const region = document.getElementById(relationshipIds[0]);
      if (!(region instanceof HTMLElement) || !root.contains(region)) {
        throw new Error("semantic relationship points outside the canonical root");
      }
      if (config.spec.stateOwner) {
        const stateOwner = root.querySelector(config.spec.stateOwner);
        if (!(stateOwner instanceof HTMLElement)) {
          throw new Error("missing semantic state owner " + config.spec.stateOwner);
        }
        stateOwner.dataset.state = config.state;
      }

      controller.dataset.hfSemanticController = "true";
      controller.dataset.hfSemanticRelationshipId = relationshipIds[0];
      region.dataset.hfSemanticRegion = "true";
      controller.setAttribute("aria-expanded", String(open));
      if (config.spec.relationship === "aria-describedby" && !open) {
        controller.removeAttribute("aria-describedby");
      }
      region.hidden = !open;
      region.inert = !open;
      if (open) region.removeAttribute("aria-hidden");
      else region.setAttribute("aria-hidden", "true");
    })();
  </script>`;
  return fixture.replace("</body>", `${stateScript}\n  </body>`);
}

export function createDemoFixture(demoHtml: string, options: DemoFixtureOptions): string {
  const externalScripts =
    demoHtml.match(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/gi) ?? [];
  if (externalScripts.length !== 1) {
    throw new Error(
      `demo must contain exactly one external GSAP script, found ${externalScripts.length}`,
    );
  }

  const canvas = options.theme === "light" ? "#f6f5f1" : "#0a0a0a";
  let fixture = demoHtml.replace(
    externalScripts[0],
    `<script data-hf-verifier-gsap>${escapeInlineScript(options.gsapSource)}</script>`,
  );
  fixture = fixture.replace(/<html\b/, '<html data-hf-verifier-fixture="demo"');
  const themedElements =
    fixture.match(/<[a-z][^>]*\bdata-hf-theme=["'](?:dark|light)["'][^>]*>/gi) ?? [];
  if (themedElements.length !== 1) {
    throw new Error(`demo must contain exactly one themed element, found ${themedElements.length}`);
  }
  const themedElement = themedElements[0];
  fixture = fixture.replace(
    themedElement,
    themedElement.replace(
      /data-hf-theme=["'](?:dark|light)["']/i,
      `data-hf-theme="${options.theme}"`,
    ),
  );
  fixture = fixture.replace(
    "</head>",
    `    <style data-hf-verifier-shell>
      html,
      body,
      .hf-ui-demo-canvas {
        width: 100vw !important;
        height: 100vh !important;
      }
      body,
      .hf-ui-demo-canvas {
        background: ${canvas} !important;
      }
      .hf-ui-demo-canvas {
        padding: clamp(16px, 5vw, 96px) !important;
      }
    </style>
  </head>`,
  );

  if (/<script\b[^>]*\bsrc=/i.test(fixture)) {
    throw new Error("demo fixture contains an external script after GSAP inlining");
  }
  return fixture;
}

export function parseTimelineLabels(source: string): Record<string, number> {
  const callCount = source.match(/\btl\.addLabel\s*\(/g)?.length ?? 0;
  const labels: Record<string, number> = {};
  const literalPattern =
    /\btl\.addLabel\(\s*(["'])([^"']+)\1\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\)/g;
  let parsedCount = 0;
  for (const match of source.matchAll(literalPattern)) {
    parsedCount += 1;
    const label = match[2];
    const timeSource = match[3];
    if (!label || !timeSource) continue;
    if (Object.hasOwn(labels, label)) throw new Error(`duplicate timeline label ${label}`);
    labels[label] = Number(timeSource);
  }
  if (parsedCount !== callCount) {
    throw new Error("every timeline label must use a literal numeric time");
  }
  return labels;
}
