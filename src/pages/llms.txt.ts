import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { llmsTxt } from "../lib/llm-text";
import { loadProjects } from "../lib/load-projects";
import { FORMSPREE_ENDPOINT, SITE_URL } from "../lib/site-config";

export const GET: APIRoute = () =>
  new Response(llmsTxt(loadProjects(), DATA_AS_OF, SITE_URL, FORMSPREE_ENDPOINT), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
