import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://chicagopipeline.com",
  // `file` format + no trailing slash: /projects/x is served from projects/x.html on
  // Cloudflare Workers assets without a redirect, so canonical URLs match links.
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [sitemap()],
});
