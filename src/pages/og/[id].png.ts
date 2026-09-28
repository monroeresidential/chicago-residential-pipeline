import type { APIRoute, GetStaticPaths } from "astro";
import { loadProjects } from "../../lib/load-projects";
import { projectOgContent, renderOgPng, siteOgContent, type OgContent } from "../../lib/og";

export const getStaticPaths = (() => {
  const projects = loadProjects();
  return [
    { params: { id: "site" }, props: { content: siteOgContent(projects) } },
    ...projects.map((p) => ({ params: { id: p.id }, props: { content: projectOgContent(p) } })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(await renderOgPng((props as { content: OgContent }).content), {
    headers: { "Content-Type": "image/png" },
  });
