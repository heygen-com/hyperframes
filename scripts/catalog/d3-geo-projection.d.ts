// d3-geo-projection ships no type declarations; only geoProject is used here.
declare module "d3-geo-projection" {
  import type { GeoProjection } from "d3-geo";
  import type { GeoJsonObject } from "geojson";
  /** Runs `object` through the projection's stream and returns planar GeoJSON. */
  export function geoProject<T extends GeoJsonObject>(object: T, projection: GeoProjection): T;
}
