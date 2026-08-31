---
title: Fail-closed validation for embedded web capture resources
date: 2026-08-30
category: security-issues
module: "@hyperframes/core web capture"
problem_type: security_issue
component: service_object
severity: high
symptoms:
  - "Header-shaped image, font, and media payloads passed cheap metadata inspection even when real decoders rejected them."
  - "Compressed font bytes were treated as their decoded memory cost."
  - "Decoder rejection, cancellation, and hangs could escape or stall the tagged failure protocol."
  - "Expensive resource work could begin before the complete envelope and resource batch earned trust."
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - "testing_framework"
tags:
  - "browser-capture"
  - "clipboard-contract"
  - "resource-validation"
  - "fail-closed"
  - "quota-enforcement"
  - "decode-boundary"
---

# Fail-closed validation for embedded web capture resources

## Problem

A web capture envelope crosses an untrusted clipboard boundary and may embed encoded images, fonts, and media. A single interleaved validation loop let expensive decoders run before the complete package had passed every cheap, deterministic check.

That ordering made several unsafe states possible. Header-shaped garbage could claim valid metadata, compressed resources could hide their expanded cost, a later bad resource could fail only after an earlier resource entered a decoder, and a decoder could reject or hang outside the public failure protocol.

## Symptoms

- Arbitrary or corrupt bytes could masquerade as an allowed MIME type when their header looked plausible.
- A WOFF2 payload could satisfy a compressed-byte budget while declaring an unsafe expanded size.
- A decoder exception rejected the public promise instead of returning a closed failure value.
- An oversized envelope or a bad SHA later in the batch still produced earlier materializer calls.
- Static hashing consumed time from the materialization deadline, so a fast decoder could be aborted before it started.

## What Didn't Work

- **Trusting declarations:** producer-supplied MIME, dimensions, duration, and expanded size are claims, not observations.
- **Trusting headers as final proof:** header inspection is useful for cheap rejection, but it cannot prove that a real decoder can materialize the bytes safely.
- **Validating one resource at a time:** `prepare, materialize, repeat` lets an early resource cross the capability boundary before a later resource invalidates the batch.
- **One timer around unrelated work:** starting the decoder clock before batch hashing charges deterministic preflight work against the wrong budget.
- **Catching only decoder errors:** a promise that never settles is also a failure mode and needs cancellation plus a deadline.

## Solution

Use two phases separated by a hard batch gate.

First, validate and prepare the complete package without invoking a resource materializer:

1. Validate the route, canonical grammar, schema, artifact relationships, and unique resource IDs.
2. Verify the final canonical UTF-8 size and envelope digest.
3. Apply aggregate quotas, including expanded costs such as decoded font bytes.
4. Canonically decode every resource and compare its exact encoded length.
5. Inspect cheap static metadata from the bytes and compare it with the declaration.
6. Verify every resource SHA.
7. Reject the whole package if any check fails. The materializer call count must still be zero.

Only then start one fresh, abort-aware deadline for full materialization of the prepared batch:

```ts
async function validateResourceBatch(envelope, options) {
  const preflightFailure = validateEnvelopeRelationshipsAndQuotas(envelope);
  if (preflightFailure) return preflightFailure;

  const prepared = [];
  for (const resource of envelope.resources) {
    const result = await prepareResource(resource);
    if (!result.ok) return result;
    prepared.push(result.value);
  }

  return withinMaterializationDeadline(options.signal, async (signal) => {
    for (const item of prepared) {
      const actual = await materializeWithAbort(item, signal);
      const failure = compareDeclaredWithActual(item.resource, actual);
      if (failure) return failure;
    }
    return null;
  });
}
```

The materializer uses a real environment decoder and returns independently observed metadata. The shared boundary owns timeout and caller cancellation, and passes the same `AbortSignal` to the decoder:

```ts
type ResourceMaterializer = (
  bytes: Uint8Array,
  staticInspection: ResourceInspection,
  signal: AbortSignal,
) => Promise<ResourceInspection | null>;
```

Decoder rejection, timeout, and cancellation remain inside the tagged failure protocol. They never become an unhandled rejection or an indefinitely pending validation call.

For compressed formats, quota the expanded claim before allocation, then verify it against the real decoder result. Compressed bytes are the shipping weight; decoded bytes are the warehouse volume.

## Why This Works

The first phase is pure proof. It performs bounded parsing, canonicalization, relationship checks, quota decisions, static inspection, and hashes. No decoder capability is available until the entire batch passes.

The second phase is the only side-effectful actor. It gets a fresh deadline, one cancellation signal, and prepared inputs whose envelope, declarations, and hashes are already trusted. Real decoder output is still compared with the producer's declaration, so preparation does not become accidental final authority.

This preserves the key invariant: **no expensive materialization begins until the complete batch has passed every cheap deterministic check.**

## Prevention

- Model preparation and materialization as separate functions with different input types. A materializer should accept only a prepared resource.
- Keep one quota owner for each cost. Transport size and expanded memory cost are distinct decisions.
- Make decoder failure, timeout, and cancellation explicit tagged outcomes.
- Test validation order through observable side effects. An invalid final envelope or one bad resource anywhere in the batch must leave the materializer call count at zero.
- Use real decoders in contract tests for every allowed resource family. Synthetic headers only prove the cheap inspection phase.
- Prove critical witnesses are non-vacuous by temporarily breaking the implementation and confirming the regression test fails for the intended reason.
- Bound work by production cardinality. One deadline covers the materialization batch instead of restarting for every resource.

## Related Issues

- [Browser capture v2 contract](../../contracts/browser-capture-v2.html) defines the trust boundary, canonical envelope, validation order, budgets, and closed refusal behavior.
- The URL-based design import described in [Send designs to HyperFrames](../../guides/claude-design-send-to-hyperframes.md) is a separate transport contract and should not be conflated with the local clipboard envelope.
