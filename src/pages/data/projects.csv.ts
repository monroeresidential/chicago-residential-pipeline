import type { APIRoute } from "astro";
import { projectsToCsv } from "../../lib/export";
import { loadProjects } from "../../lib/load-projects";

export const GET: APIRoute = () =>
  new Response(projectsToCsv(loadProjects()), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
