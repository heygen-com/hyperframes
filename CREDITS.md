# Credits

## Prior art

HyperFrames was inspired by prior work in the browser-based video rendering space.
In particular, we want to acknowledge:

- **[Remotion](https://www.remotion.dev)** pioneered the approach of using a
  headless browser + FFmpeg `image2pipe` pipeline to turn web primitives into
  deterministic video in the JavaScript ecosystem. Several of HyperFrames'
  architectural ideas — ordered async barriers for parallel frame capture,
  multi-host port availability probing for dev servers, and the broader shape
  of a "render HTML to video" CLI — were informed by studying how Remotion
  approaches these problems.

All code in this repository is independently implemented and distributed
under the [Apache 2.0 License](LICENSE). HyperFrames is not affiliated with
Remotion.

## Thanks

Thanks also to the authors and maintainers of the open-source projects
HyperFrames builds on, including Puppeteer, FFmpeg, GSAP, Hono, and the
broader Node.js ecosystem.
