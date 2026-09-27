# Running from an installed plugin

Check the directory two levels above the loaded `SKILL.md` for `plugin.json`,
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or
`.cursor-plugin/plugin.json` identifying `hyperframes`, or `gemini-extension.json`.
That directory is `<PLUGIN_ROOT>`. If none exists, this is a standalone skill;
follow the normal installation and freshness instructions.

For a plugin installation, these rules replace the standalone update commands
in every workflow and reference:

- Do not run `hyperframes skills update`, `skills check`, or `npx skills add`.
  The agent's plugin manager owns installation and updates. Read the workflow at
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
  CLI version through npm. A download failure is an error, not permission to use
  latest. Existing project dependency files and lockfiles must not be overwritten
  to match the plugin; surface a runtime incompatibility before changing them.

- For bundled Node helpers that bootstrap HyperFrames packages, use the same
  launcher with `--script <absolute-script-path> <args...>`. This passes the
  release version to their dependency loader. External providers, registry
  downloads, and existing project dependencies have their own versions; a plugin
  version alone does not freeze those inputs.
- Treat the plugin directory as read-only. Put outputs and temporary work in the
  project or a temporary directory. Pass this plugin root and launcher convention
  to any delegated workflow so it does not fall back to global skills.

To get newer skills, use the client's plugin update flow and reload the session.
Do not silently update an installed plugin during a video task.
