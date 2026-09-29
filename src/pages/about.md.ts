import type { APIRoute } from "astro";
import { DATA_AS_OF } from "../lib/data-meta";
import { aboutMarkdown } from "../lib/llm-text";
import { FORMSPREE_ENDPOINT, SITE_URL } from "../lib/site-config";

export const GET: APIRoute = () =>
  new Response(aboutMarkdown(DATA_AS_OF, SITE_URL, FORMSPREE_ENDPOINT), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
