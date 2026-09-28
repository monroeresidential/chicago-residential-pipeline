import type { Project, ProjectCollection, ProjectFeature } from "./schema";

export function toFeatureCollection(projects: readonly Project[], asOf: string): ProjectCollection {
  return {
    type: "FeatureCollection",
    as_of: asOf,
    features: projects.map(({ lat, lng, ...rest }) => ({
      type: "Feature",
      id: rest.id,
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { ...rest, as_of: asOf },
    })),
  };
}

export function featureToProject(f: ProjectFeature): Project {
  const { as_of: _asOf, ...rest } = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  return { ...rest, lat, lng };
}
