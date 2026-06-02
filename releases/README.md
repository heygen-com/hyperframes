# Release notes

Reviewed GitHub Release bodies live here.

Create the next draft with:

```bash
bun run release:prepare <version>
```

The first run drafts missing changelog artifacts and exits non-zero for review. After rewriting the generated TODO summary, rerun the same command to create the release commit and tag.

The publish workflow uses `releases/v<version>.md` as the GitHub Release body when the file exists. Keep these notes user-facing; implementation details can stay in pull requests.
