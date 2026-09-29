// Runs in front of the static assets (wrangler.jsonc: run_worker_first). Sends www and the old
// Monroe subdomain to the same path on the canonical domain; everything else is a static asset.

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBinding;
}

export const CANONICAL_ORIGIN = "https://chicagopipeline.com";
const REDIRECT_HOSTS = new Set(["www.chicagopipeline.com", "pipeline.monroeresidential.com"]);

export function redirectFor(url: URL): string | null {
  if (!REDIRECT_HOSTS.has(url.hostname)) return null;
  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}${url.hash}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const target = redirectFor(new URL(request.url));
    return target ? Response.redirect(target, 301) : env.ASSETS.fetch(request);
  },
};
