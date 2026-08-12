import { describe, expect, it } from "vitest";
import { NotMediaPayloadError } from "@hyperframes/engine";
import { extractSafeRenderErrorMetadata } from "./server.js";

// Kept out of server.errorCode.test.ts so that suite keeps exactly one typed
// error class in scope: two same-shaped classes there defeat the dead-code
// analyzer's member resolution and it reports the sibling's fields as unused.
describe("extractSafeRenderErrorMetadata — non-media payloads", () => {
  it("transports the code, owner, and retry policy", () => {
    // Without the SAFE_RENDER_ERROR_CODES entry the API emits
    // `errorCode: undefined` and the failure is indistinguishable from an
    // untyped crash — as unroutable as the `moov atom not found` it replaces.
    expect(extractSafeRenderErrorMetadata(new NotMediaPayloadError(["0123456789abcdef"]))).toEqual({
      errorCode: "NOT_MEDIA_PAYLOAD",
      errorOwner: "user",
      retryable: false,
    });
  });
});
