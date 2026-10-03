// Plain constants shared by the site (build time and browser bundle) and the server. No Zod here: anything imported by
// client scripts must stay free of the validation library (see src/lib/schema.ts).

export const STATUSES = ["completed", "under_construction", "permitted", "approved", "planning"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  completed: "Completed",
  under_construction: "Under construction",
  permitted: "Permitted",
  approved: "Approved",
  planning: "Planning",
};

export const STATUS_COLORS: Record<Status, string> = {
  completed: "#2F3437",          // charcoal
  under_construction: "#E04F16", // 3F orange
  permitted: "#2E8B7A",          // teal
  approved: "#3B6EA5",           // blue
  planning: "#8C96A3",           // gray
};

export const PROGRAMS = ["lasalle", "private"] as const;
export type Program = (typeof PROGRAMS)[number];

export const PROGRAM_LABELS: Record<Program, string> = {
  lasalle: "LaSalle Reimagined",
  private: "Private market",
};

// Loose box around downtown Chicago; catches geocoder mistakes (wrong city, swapped lat/lng).
export const DOWNTOWN_BBOX = { minLng: -87.72, minLat: 41.84, maxLng: -87.58, maxLat: 41.93 } as const;
