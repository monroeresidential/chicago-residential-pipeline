import { createReadStream, existsSync, statSync } from "node:fs";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Dev only: serve tiles/chicago.pmtiles (gitignored; see README) with HTTP range support,
// because the public Protomaps builds don't send CORS headers for localhost.
const DEV_TILES = "tiles/chicago.pmtiles";
const devTiles = {
  name: "dev-tiles",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/dev-tiles/chicago.pmtiles", (req, res) => {
      if (!existsSync(DEV_TILES)) {
        res.statusCode = 404;
        res.end(`Missing ${DEV_TILES}. See README → "Map tiles".`);
        return;
      }
      const { size } = statSync(DEV_TILES);
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(range ? 206 : 200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range && { "Content-Range": `bytes ${start}-${end}/${size}` }),
      });
      createReadStream(DEV_TILES, { start, end }).pipe(res);
    });
  },
};

export default defineConfig({
  site: "https://pipeline.monroeresidential.com",
  // `file` format + no trailing slash: /projects/x is served from projects/x.html on
  // Cloudflare Workers assets without a redirect, so canonical URLs match links.
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [sitemap()],
  vite: { plugins: [devTiles] },
});
