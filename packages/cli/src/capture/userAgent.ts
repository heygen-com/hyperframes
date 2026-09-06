/**
 * The single identity a capture presents to the origin it is capturing.
 *
 * A capture is one session with two halves: Chrome navigates the page, then Node fetches the
 * assets that page referenced. When those halves send different `User-Agent` headers the origin
 * is free to answer them differently, and an anti-bot edge does exactly that — it serves the
 * document to the browser and refuses the out-of-band asset fetch.
 *
 * Measured against openai.com: `GET /favicon.svg` answers `403 text/html` for `HyperFrames/1.0`
 * and `200 image/svg+xml` for this string. The favicon ranker had already chosen that SVG as the
 * best declared icon; the 403 discarded it and the capture silently fell through to the next
 * candidate, so the icon on disk was decided by the CDN's bot rules rather than by the ranker.
 *
 * One constant, used by both halves, is what keeps that from being reintroduced.
 */
export const CAPTURE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
