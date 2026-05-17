# Pattern: api-library-feature

## When to Use

- New public API, hook, or utility function
- New library integration or protocol support
- New type that changes how consumers write code

## Scene Sequence (30s target)

1. **HookTitle** (0-3s) — Result or Comparison pattern preferred
2. **ProblemSetup** (3-8s) — show the "before" world
3. **LibrarySwap** or **CodeSnippet** (8-22s) — core showcase of the new API in action
4. **CTAEndScreen** (22-30s)

## Code Handling

**Synthesize realistic usage code.** Verify synthesized code against the library's actual public API before including it.

## Hook Pattern Bias

Strong fit: Result, Comparison, Curiosity-gap.
Weaker fit: Mistake, Pattern-interrupt.

## Example

PR: adds `@standard-schema/spec` support to a form library.

- HookTitle: `"Zod, Valibot, Arktype — same code"` (Comparison, 5 words)
- ProblemSetup: "Three libraries, three syntaxes, same task"
- LibrarySwap: shared Standard Schema validation code with import line cycling through `zod`, `valibot`, `arktype`
- CTAEndScreen: "Ship it" + `standardschema.dev`
