# Running from an installed plugin

Check the directory two levels above the loaded `SKILL.md` for `plugin.json`,
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or
`.cursor-plugin/plugin.json` identifying `hyperframes`, or a Gemini extension manifest.
That directory is `<PLUGIN_ROOT>`. If none exists, this is a standalone skill
install; run `npx hyperframes` directly.

For a plugin installation, these rules apply in every skill and reference:

- Do not run `hyperframes skills update`, `skills check`, or `npx skills add`.
  The agent's plugin manager owns installation and updates. Read the skill at
  `<PLUGIN_ROOT>/skills/<name>/SKILL.md`; report a missing bundled skill instead
  of downloading a different release. Resolve all skill references inside this
  bundle, even if a standalone copy is also installed. Claude exposes the router
  as `/hyperframes:hyperframes`; other clients may expose `/hyperframes`.
- Replace `npx hyperframes` (or bare `hyperframes`) in command examples with:

  ```bash
  node "<PLUGIN_ROOT>/skills/hyperframes/scripts/plugin-cli.mjs" <command> <args...>
  ```

  Run in the user's project directory, never in the plugin directory. The launcher
  selects the manifest's CLI version and disables automatic standalone skill
  installation, including during `init`. The first call may download that exact
  CLI version through npm. npm runs from the home folder, so the project's
  `node_modules`, `package.json` and `.npmrc` cannot choose the CLI; the CLI then
  works in the project. A download failure is an error, not permission to use
  latest. Existing project dependency files and lockfiles must not be overwritten
  to match the plugin; surface a runtime incompatibility before changing them.

- For bundled Node helpers, use the same
  launcher with `--script <absolute-script-path> <args...>`. This passes the
  release version to their dependency loader, and helpers that call the CLI run
  it through the launcher. External providers, registry
  downloads, and existing project dependencies have their own versions; a plugin
  version alone does not freeze those inputs.
- Treat the plugin directory as read-only. Put outputs and temporary work in the
  project or a temporary directory. Pass this plugin root and launcher convention
  to any delegated agent so it does not fall back to global skills.

Newer skills come through the client's plugin update flow and a session reload,
which the person runs. Do not update an installed plugin yourself.

The launcher suppresses CLI update notices as well as standalone skill refreshes, including when running an older CLI with a stale notice cache. It passes the release as `HYPERFRAMES_PLUGIN_VERSION` for plugin-aware helpers and as `HYPERFRAMES_SKILL_PKG_VERSION` for the existing helper-package bootstrap. Our release process versions those packages together.
