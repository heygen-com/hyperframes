# Release notes

Reviewed GitHub Release bodies live here.

Create the next draft with:

```bash
bun run changelog:draft <version> --write
```

The publish workflow uses `releases/v<version>.md` as the GitHub Release body when the file exists. Keep these notes user-facing; implementation details can stay in pull requests.
