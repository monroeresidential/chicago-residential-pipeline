import { z } from "zod";

export const STATUSES = ["completed", "under_construction", "permitted", "approved", "planning"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const STATUS_LABELS: Record<Status, string> = {
  completed: "Completed",
  under_construction: "Under construction",
  permitted: "Permitted",
  approved: "Approved",
  planning: "Planning",
};

export const STATUS_COLORS: Record<Status, string> = {
  completed: "#00051B",
  under_construction: "#33709B",
  permitted: "#2E8B7A",
  approved: "#C28A2C",
  planning: "#8C96A3",
};

export const PROGRAMS = ["lasalle", "private"] as const;
export const ProgramSchema = z.enum(PROGRAMS);
export type Program = z.infer<typeof ProgramSchema>;

export const PROGRAM_LABELS: Record<Program, string> = {
  lasalle: "LaSalle Reimagined",
  private: "Private market",
};

// Loose box around downtown Chicago; catches geocoder mistakes (wrong city, swapped lat/lng).
export const DOWNTOWN_BBOX = { minLng: -87.72, minLat: 41.84, maxLng: -87.58, maxLat: 41.93 } as const;

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
  monroe_url: z.url().nullable(),
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
