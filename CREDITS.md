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
  permission under this repository's license. What they vendor or load, by upstream:
  - **[three.js](https://threejs.org)**, MIT. Vendored as r185 in `frost-sequence-camera-orbit`,
    `cuboid-carousel` and `orbit-card` (`Three-LICENSE.txt` beside the copy); bundled as r181 inside
    `glass-shard-title`'s `glass-main.js`; loaded from the jsDelivr CDN by `canopy-part-title`
    (0.170.0) and `wireframe-portal-title` (0.181.2).
  - **[GSAP](https://gsap.com)** 3.14.2, under the [GSAP Standard License](https://gsap.com/standard-license)
    (not an OSI open-source licence). Vendored in `code-slice-hero`, `cuboid-carousel`,
    `frost-sequence-camera-orbit` and `orbit-card` with `GSAP-NOTICE.txt`; loaded from the CDN by
    `glass-shard-title`, `canopy-part-title` and `wireframe-portal-title`.
  - **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** 0.9.14 and
    **[opentype.js](https://github.com/opentypejs/opentype.js)** 2.x (range in the block's
    `source/package.json`), both MIT, bundled into the frost block's `frost.js`.
  - **[Clipper](https://sourceforge.net/projects/jsclipper/)** 6.4.2 (JavaScript port of Angus
    Johnson's Clipper), Boost Software License 1.0: build-time source of `frost-sequence-camera-orbit`
    and loaded from the CDN as `clipper-lib` by `wireframe-portal-title`.
  - **[d3-delaunay](https://github.com/d3/d3-delaunay)** 6.0.4, ISC, loaded from the CDN by
    `glass-shard-title`.
  - **[Geist](https://github.com/vercel/geist-font)**, **[Archivo](https://github.com/Omnibus-Type/Archivo)**
    and **[Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant)**, SIL Open Font License 1.1,
    vendored with their licence text; `canopy-part-title` (Gelasio) and `cuboid-carousel` (Inter) load
    their fonts from Google Fonts at run time.
  - **[Ferndale Studio 01](https://polyhaven.com/a/ferndale_studio_01)** HDR from Poly Haven, CC0
    (`glass-shard-title`); it needs no licence text.
  - Origin to be confirmed with the author: `canopy-part-title/assets/leaf-surface-color.webp` and
    `leaf-surface-normal.webp`, `glass-shard-title/assets/matcap-1.png`,
    `frost-sequence-camera-orbit/assets/shards-atlas.png`,
    `frost-sequence-camera-orbit/assets/textures/ice-inclusions-generated.png` and
    `frost-sequence-camera-orbit/assets/textures/bluenoise64.png`.
