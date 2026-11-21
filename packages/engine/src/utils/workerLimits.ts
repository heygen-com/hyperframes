// Hard ceiling on explicit `--workers N` requests. Above this, the cost of
// CDP-protocol dispatch through Node's main event loop and OS scheduling
// noise overwhelms any further parallelism. Bumped from 10 → 24 in hf#732
// follow-up so high-core hosts (32-96+ cores) can actually surface the
// hardware to renders that are CPU-bound on DOM capture.
export const ABSOLUTE_MAX_WORKERS = 24;
