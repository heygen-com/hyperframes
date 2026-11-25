import postcss from "postcss";

// Blocks belong to a single lint context. Weak keys release each parsed tree after the pass.
const parsed = new WeakMap<object, { root: postcss.Root } | { error: unknown }>();

/** The block's CSS tree, parsed once and shared by every rule, so rules must not change it. Throws the parse error. */
export function styleRoot(style: { content: string }): postcss.Root {
  let entry = parsed.get(style);
  if (!entry) {
    try {
      entry = { root: postcss.parse(style.content) };
    } catch (error) {
      entry = { error };
    }
    parsed.set(style, entry);
  }
  if ("error" in entry) throw entry.error;
  return entry.root;
}
