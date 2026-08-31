# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Browser Capture

### Web Capture Envelope

The canonical clipboard package that carries one captured artifact, its local resources, producer diagnostics, source claims, and an integrity digest for Studio to validate as a unit.

An envelope is accepted or rejected atomically. No embedded resource may cross into full materialization until the complete envelope and resource batch pass deterministic preflight validation.

### Captured Artifact

The representation Studio can persist from a web capture, either editable document content, finite local media, or a still image with an explicit completeness claim.

### Representation Decision

The producer's explicit choice of captured artifact kind and time model after classifying what the selected page content can faithfully support.

Rejection is a decision outcome but never a persistable artifact.

### Capture Claims

The producer assertions that bind a captured artifact to its source frame, time model, and fixed viewport behavior so the consumer can validate representation consistency.

### Prepared Resource

An embedded capture resource whose canonical encoding, byte count, static metadata, expanded-cost claim, and content digest have all passed deterministic validation, but which has not yet entered a full decoder.

### Resource Materialization

The bounded capability phase that uses a real decoder to turn a prepared image, font, or media resource into independently observed metadata.

Materialization is abort-aware, starts only after the full batch is prepared, and never owns envelope or quota decisions made during preflight.

## Relationships

A Web Capture Envelope owns one Captured Artifact and zero or more embedded resources. Its Representation Decision must agree with its Capture Claims. Every embedded resource becomes a Prepared Resource before the batch may enter Resource Materialization.
