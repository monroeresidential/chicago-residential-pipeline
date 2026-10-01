import { z } from "zod";

import { DOWNTOWN_BBOX, PROGRAMS, STATUSES } from "./constants";

export * from "./constants";

export const StatusSchema = z.enum(STATUSES);
export const ProgramSchema = z.enum(PROGRAMS);

export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase slug"),
  dpd_map_no: z.number().int().min(1).max(25).nullable(),
  name: z.string().min(1).nullable(),
  address: z.string().min(1),
  developer: z.string().min(1).nullable(),
  units: z.number().int().positive().nullable(),
  affordable_units: z.number().int().nonnegative().nullable(),
  tpc_musd: z.number().positive().nullable(),
  program: ProgramSchema,
  public_support: z.string().min(1).nullable(),
  status: StatusSchema,
  status_note: z.string().min(1),
  flag: z.string().min(1).nullable(),
  confidence: z.enum(["dpd", "reported"]),
  built_by_3f_url: z.url().nullable(),
  lat: z.number().min(DOWNTOWN_BBOX.minLat).max(DOWNTOWN_BBOX.maxLat),
  lng: z.number().min(DOWNTOWN_BBOX.minLng).max(DOWNTOWN_BBOX.maxLng),
  sources: z.array(z.url()).min(1),
  notes: z.string().min(1).nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export type ProjectProperties = Omit<Project, "lat" | "lng"> & { as_of: string };

export interface ProjectFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: ProjectProperties;
}

export interface ProjectCollection {
  type: "FeatureCollection";
  as_of: string;
  features: ProjectFeature[];
}
