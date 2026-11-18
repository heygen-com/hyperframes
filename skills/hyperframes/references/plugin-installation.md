# Running the HyperFrames CLI

`<SKILLS>` is the folder that holds the loaded skill's folder. Every skill and reference writes
the CLI as `npx hyperframes` (or bare `hyperframes`). Run each of those commands as:

```bash
node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" <command> <args...>
```

Run it in the user's project directory, never in the skills directory. npm starts in the home
folder, so the project's `package.json`, `node_modules` and `.npmrc` cannot choose the CLI or the
registry; the CLI then moves into the project and works there. This holds for every command,
including the usage beacon, and for a project the person received from someone else. Do not run
`npx hyperframes` in the project directly, and do not run a project's own scripts or wrappers in
its place unless the person asks for that command by name.

For bundled Node helpers, use the same launcher with
`--script <absolute-script-path> <args...>`. Helpers that call the CLI then run it through the
launcher.

## Standalone skill installs

Without a plugin manifest, the launcher runs the newest compatible published CLI. To select a
release, put `--cli-version latest` or `--cli-version <exact-version>` before the command.
Take an exact version from the person, from the version an upgrade moves the pins to, or from
`--cli-version latest --version`. Never take it from the project's own files: a `package.json`
pin does not choose the CLI unless the person asks for that release. The launcher refuses a release older than its floor (currently 0.9.65), the oldest one with
the protections for received projects, and its error names the floor.
Use the launcher from the loaded skill installation for commands shown in CLI output, too.
For example, run `node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version latest --version`
to read the current release. If the installed launcher lacks this option, ask the person to update
their skills. The person installs and
updates standalone skills with `npx hyperframes skills update`.

## Plugin installs

Check the directory two levels above the loaded `SKILL.md` for `plugin.json`,
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or
`.cursor-plugin/plugin.json` identifying `hyperframes`, or a Gemini extension manifest.
That directory is `<PLUGIN_ROOT>`, and `<SKILLS>` is `<PLUGIN_ROOT>/skills`.

Call the directory you run the launcher in the working directory. It is a plugin install only
when all three of these hold:

- The name of `<PLUGIN_ROOT>` does not start with a dot, so it is not `.agents` or `.claude`.
- `<PLUGIN_ROOT>` is not the working directory, and it does not contain it.
- If `<PLUGIN_ROOT>` is inside the working directory, a folder whose name starts with a dot
  lies between them, as `.claude` does in `~/.claude/plugins/...` when you work in `~`.

Otherwise the skills are a standalone install, and the launcher ignores any manifest there.
Ignore it too, and follow the standalone rules above. The launcher refuses a manifest that
pins a release older than its floor.

For a plugin installation, these rules also apply in every skill and reference:

- Do not run `hyperframes skills update`, `skills check`, or `npx skills add`.
  The agent's plugin manager owns installation and updates. Read the skill at
  `<PLUGIN_ROOT>/skills/<name>/SKILL.md`; report a missing bundled skill instead
  of downloading a different release. Resolve all skill references inside this
  bundle, even if a standalone copy is also installed. Claude exposes the router
  as `/hyperframes:hyperframes`; other clients may expose `/hyperframes`.
- The launcher selects the manifest's CLI version and disables automatic standalone skill
  installation, including during `init`. The first call may download that exact
  CLI version through npm. A download failure is an error, not permission to use
  latest. Existing project dependency files and lockfiles must not be overwritten
  to match the plugin; surface a runtime incompatibility before changing them.
- For bundled Node helpers, the launcher also passes the release version to their
  dependency loader. External providers, registry downloads, and existing project
  dependencies have their own versions; a plugin version alone does not freeze those inputs.
- Treat the plugin directory as read-only. Put outputs and temporary work in the
  project or a temporary directory. Pass this plugin root and launcher convention
  to any delegated agent so it does not fall back to global skills.

Newer skills come through the client's plugin update flow and a session reload,
which the person runs. Do not update an installed plugin yourself.

The launcher suppresses CLI update notices as well as standalone skill refreshes, including when running an older CLI with a stale notice cache. It passes the release as `HYPERFRAMES_PLUGIN_VERSION` for plugin-aware helpers and as `HYPERFRAMES_SKILL_PKG_VERSION` for the existing helper-package bootstrap. Our release process versions those packages together.
