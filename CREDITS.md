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

## Third-party licenses

- **[mediabunny](https://github.com/Vanilagy/mediabunny)** — media toolkit used
  in the studio for fast metadata extraction from file headers. Licensed under
  the [Mozilla Public License 2.0 (MPL-2.0)](https://mozilla.org/MPL/2.0/).
- The seven 3D-motion catalog pieces (`canopy-part-title`, `glass-shard-title`,
  `code-slice-hero`, `frost-sequence-camera-orbit`, `cuboid-carousel`,
  `orbit-card`, `wireframe-portal-title`) are contributed with their author's
  permission under this repository's license. They vendor the following, each
  with its licence text beside the copy in the block's `assets/` (the CC0 HDR needs none):
  - **[three.js](https://threejs.org)** r185, MIT.
  - **[GSAP](https://gsap.com)** 3.14.2, under the [GSAP Standard License](https://gsap.com/standard-license)
    (not an OSI open-source licence); `GSAP-NOTICE.txt` sits beside each copy.
    `glass-shard-title` loads GSAP from the CDN instead of vendoring it.
  - **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** 0.9.14, MIT,
    and **[opentype.js](https://github.com/opentypejs/opentype.js)** ^2.0.0, MIT,
    both bundled into the frost block's `frost.js`.
  - **[Clipper](https://sourceforge.net/projects/jsclipper/)** (JavaScript port of
    Angus Johnson's Clipper) 6.4.2, Boost Software License 1.0, used at build time by
    the frost block's source.
  - **[Geist](https://github.com/vercel/geist-font)**, **[Archivo](https://github.com/Omnibus-Type/Archivo)**
    and **[Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant)**, SIL Open Font License 1.1.
  - **[Ferndale Studio 01](https://polyhaven.com/a/ferndale_studio_01)** HDR from
    Poly Haven, CC0 (`glass-shard-title`).
  - Origin to be confirmed with the author: `canopy-part-title/assets/leaf-surface-color.webp`
    and `leaf-surface-normal.webp`.
