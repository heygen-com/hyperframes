# Validate local sharing

Run the share package, CLI, and Studio tests before publishing a change to the sharing flow. For manual verification, create a review link in the CLI, then open the same folder in local Studio and add a version. Verify that both surfaces reuse the existing link and that an interrupted upload can resume without creating another version.

Check that copying an existing link leaves local edits untouched, that changing or disabling access preserves the expected link state, and that existing published links and updates continue to work. For accounts that support editable project files, verify that the source matches the rendered version and can be opened by an authorized recipient.

Sharing telemetry uses the existing CLI preference. Verify that opting out suppresses events and that payloads contain no project paths, titles, review links, credentials, or raw errors. Upload admission, playback readiness, and copying a link are separate events.
