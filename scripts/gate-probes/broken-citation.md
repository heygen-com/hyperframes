# A citation that must never resolve

This file is not documentation. `check-comment-citations.mjs` grades it before anything else, so a
checker that has stopped resolving citations fails instead of printing OK.

Both citations below are dead on purpose and must stay dead. Do not create either name.

The fence is pinned by `gate-probe-no-such-file.test.ts`, and the value comes from
`gateProbeNoSuchSymbol` at `gate-probe-no-such-file.ts:4242`.
