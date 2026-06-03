# Weekly updates

Weekly digest source files and social drafts live here.

Generate the next editorial packet with:

```bash
bun run changelog:weekly --from YYYY-MM-DD --to YYYY-MM-DD --write
```

Run the command from an up-to-date `main` branch so the draft reflects the public Git history for the selected week.

The command creates:

- `updates/weekly/YYYY-MM-DD.md`
- `updates/social/YYYY-MM-DD.discord.md`
- `updates/social/YYYY-MM-DD.x.md`

It also prepends a matching entry to `docs/weekly-updates.mdx`.

Review and rewrite the generated files before publishing. Social drafts are distribution copy for humans to post manually; they are not posted automatically.
