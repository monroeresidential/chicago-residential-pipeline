import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { toFeatureCollection } from "../../lib/geojson";
import { loadProjects } from "../../lib/load-projects";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(toFeatureCollection(loadProjects(), DATA_AS_OF)), {
    headers: { "Content-Type": "application/geo+json; charset=utf-8" },
  });
