#!/usr/bin/env node
/**
 * Recipes CLI — the heavyweight tier of HyperFrames user memory.
 *
 *   node recipe.mjs freeze --hyperframes . --name <n> [--workflow <w>] [--blocks a,b,c]
 *     Freeze the current approved run as a named recipe: frame.md + the
 *     storyboard skeleton (structure kept, content blanked) + the brief
 *     skeleton (when BRIEF.md exists) + the confirmed brief values.
 *     The workflow is read from BRIEF.md; --workflow only covers projects
 *     briefed before BRIEF.md existed. Re-freezing the same name bumps the
 *     version and archives the old folder as <name>@v<N>. Promotes to
 *     ~/.media/recipes/ immediately.
 *
 *   node recipe.mjs list --hyperframes . [--workflow <w>] [--json]
 *     Two-tier merged listing (project wins), newest approval first.
 *
 *   node recipe.mjs use --hyperframes . --name <n> [--json]
 *     Adopt a recipe: import it from the user tier if needed, copy its
 *     frame.md over the project's, and print the brief values + skeleton path.
 *
 * When recipes are offered/consumed is the review loop's and the intent
 * layer's business — see hyperframes-core/references/review-loop.md § 4 and
 * the intent layer's recipe check (hyperframes SKILL.md § 4).
 */
import { parseArgs } from "node:util";
import { freezeRecipe, listRecipes, useRecipe } from "./lib/recipe-store.mjs";

const { values: args, positionals } = parseArgs({
  options: {
    hyperframes: { type: "string", default: "." },
    name: { type: "string" },
    workflow: { type: "string" },
    blocks: { type: "string" },
    json: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const verb = positionals[0];

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  if (verb === "freeze") {
    if (!args.name) fail("freeze needs --name");
    const frozen = freezeRecipe({
      projectDir: args.hyperframes,
      name: args.name,
      workflow: args.workflow,
      blocks: args.blocks
        ? args.blocks
            .split(",")
            .map((b) => b.trim())
            .filter(Boolean)
        : undefined,
    });
    if (args.json) console.log(JSON.stringify({ ok: true, ...frozen }));
    else {
      console.log(
        `froze recipe ${frozen.slug} (v${frozen.version}, ${frozen.workflow}) → ${frozen.dir}`,
      );
      if (frozen.workflowOverridden)
        console.log(`  (BRIEF.md says "${frozen.workflow}" — the --workflow flag was ignored)`);
      if (!frozen.briefSkeleton)
        console.log("  (no BRIEF.md in the project — brief skeleton skipped)");
    }
  } else if (verb === "list") {
    const list = listRecipes({ projectDir: args.hyperframes, workflow: args.workflow });
    if (args.json) console.log(JSON.stringify(list));
    else if (list.length === 0) console.log("no recipes yet");
    else {
      for (const r of list) {
        console.log(
          `${r.name}  v${r.version}  ${r.workflow}  (${r.source}; approved ${String(r.approved_at ?? "?").slice(0, 10)})`,
        );
      }
    }
  } else if (verb === "use") {
    if (!args.name) fail("use needs --name");
    const used = useRecipe({ projectDir: args.hyperframes, name: args.name });
    if (args.json) console.log(JSON.stringify({ ok: true, ...used }));
    else {
      console.log(
        `using recipe ${used.recipe.name} (v${used.recipe.version}, ${used.recipe.workflow})`,
      );
      console.log(`  frame spec → ${used.frameSpecPath} (copied over)`);
      console.log(`  storyboard skeleton → ${used.skeletonPath}`);
      if (used.briefSkeletonPath) console.log(`  brief skeleton → ${used.briefSkeletonPath}`);
      for (const key of ["destination", "aspect", "language", "voice", "style_preset"]) {
        if (used.recipe[key]) console.log(`  ${key}: ${used.recipe[key]}`);
      }
    }
  } else {
    fail(
      "usage: recipe.mjs <freeze|list|use> --hyperframes . [--name <n>] [--workflow <w>] [--blocks a,b] [--json]",
    );
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
