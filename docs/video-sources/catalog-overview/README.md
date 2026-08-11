# Catalog overview video

The source composition assembles frozen local copies of eleven Catalog previews in sidebar
order. Rebuild it from the repository root:

```bash
bun scripts/catalog-overview-video/prepare-assets.ts
npx hyperframes@0.7.107 lint docs/video-sources/catalog-overview
npx hyperframes@0.7.107 check docs/video-sources/catalog-overview --at-transitions --snapshots
npx hyperframes@0.7.107 render docs/video-sources/catalog-overview \
  --fps 60 --quality high --workers 1 --strict \
  --output docs/video-sources/catalog-overview/renders/catalog-overview-v1.mp4
```

The acquired inputs, snapshots, and renders are reproducible outputs and stay untracked.
