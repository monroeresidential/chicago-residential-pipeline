import { namedFlavor } from "@protomaps/basemaps";

type Flavor = ReturnType<typeof namedFlavor>;

// Protomaps "light", minus POI icons (they compete with our markers), tinted to the Monroe palette.
const { pois: _pois, ...light } = namedFlavor("light");

export const BRAND_FLAVOR: Flavor = {
  ...light,
  background: "#eef0f2",
  earth: "#f3f4f6",
  water: "#bfd0dd",
  buildings: "#e1e4e8",
  park_a: "#e2e9e2",
  park_b: "#dae3da",
  wood_a: "#e2e9e2",
  wood_b: "#dae3da",
  pedestrian: "#eef0f2",
  railway: "#c9ced4",
  other: "#f7f8f9",
  minor_a: "#ffffff",
  minor_b: "#ffffff",
  link: "#ffffff",
  major: "#ffffff",
  highway: "#ffffff",
  roads_label_minor: "#7a838d",
  roads_label_major: "#5b6570",
  subplace_label: "#5b6570",
  city_label: "#2f3437",
  ocean_label: "#6f8fa8",
};
