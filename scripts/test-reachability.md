# Test reachability manifest

`test-reachability.json` supplies guards and reviewed runner mappings for
`check-test-reachability.mjs`. Only `.github/workflows/ci.yml` is modelled.
A test selected only by another workflow is reported as unreachable by this check.
For example, `windows-render.yml` selects four tests that are also routed by `ci.yml`.

`guards` maps test paths to the source paths that must trigger them. Custom runner
entries name the exact command, selected tests, and hashes of the source that owns
selection. A changed or missing pinned source requires the mapping to be reviewed.
