// Shared helpers for test-side `fetch` stubs (timelineTimingSync.test.ts,
// useTimelineEditing.test.tsx): a JSON Response factory and a Request → URL
// normalizer. Test-only module — imported exclusively from *.test.* files.

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
