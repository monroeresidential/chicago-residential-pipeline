import type { APIRoute, GetStaticPaths } from "astro";
import { DATA_AS_OF } from "../../lib/data-meta";
import { projectMarkdown } from "../../lib/llm-text";
import { loadProjects } from "../../lib/load-projects";
import type { Project } from "../../lib/schema";
import { SITE_URL } from "../../lib/site-config";

export const getStaticPaths = (() =>
  loadProjects().map((project) => ({ params: { id: project.id }, props: { project } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(projectMarkdown((props as { project: Project }).project, DATA_AS_OF, SITE_URL), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
