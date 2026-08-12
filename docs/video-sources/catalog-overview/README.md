# Catalog overview video

The source composition assembles frozen local copies of eleven Catalog previews in sidebar
order. Rebuild it from the repository root:

```bash
bun install --frozen-lockfile
bun run --filter '@hyperframes/{parsers,lint,studio-server}' build
bun run --filter @hyperframes/core build
bun run --filter @hyperframes/engine build
bun run --filter @hyperframes/producer build
bun run generate:catalog-previews --only caption-camera-follow --type component
bun run generate:catalog-previews --only ai-chat-reveal --type block
bun scripts/catalog-overview-video/prepare-assets.ts
npx hyperframes@0.7.107 lint docs/video-sources/catalog-overview
npx hyperframes@0.7.107 check docs/video-sources/catalog-overview --at-transitions --snapshots
npx hyperframes@0.7.107 render docs/video-sources/catalog-overview \
  --fps 60 --quality high --workers 1 --strict \
  --output docs/video-sources/catalog-overview/renders/catalog-overview-v3.mp4
ffmpeg -y \
  -ss 0.75 \
  -i docs/video-sources/catalog-overview/renders/catalog-overview-v3.mp4 \
  -frames:v 1 -q:v 2 \
  docs/video-sources/catalog-overview/renders/catalog-overview-v3.jpg
cp docs/video-sources/catalog-overview/renders/catalog-overview-v3.{mp4,jpg} \
  docs/images/showcase/
bash scripts/upload-docs-images.sh
```

The first Caption preview and Miao's `ai-chat-reveal` Showcases addition are rendered from their
authoritative registry sources because they have no published Catalog MP4. The remaining inputs
are acquired from the public Catalog. Generated previews, frozen inputs, snapshots, and renders
are reproducible outputs and stay untracked. Before merging, verify anonymous requests to both
`https://static.heygen.ai/hyperframes-oss/docs/images/showcase/catalog-overview-v3.mp4` and the
matching `.jpg` return 200 after the CDN invalidation completes.
