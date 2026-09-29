import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { projectsToJson } from "../../lib/export";
import { loadProjects } from "../../lib/load-projects";

export const GET: APIRoute = () =>
  new Response(projectsToJson(loadProjects(), DATA_AS_OF), { headers: { "Content-Type": "application/json; charset=utf-8" } });
