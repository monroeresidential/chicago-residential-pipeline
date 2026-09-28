# Chicago Pipeline

Interactive map of Chicago's office-to-residential conversion pipeline.
Live at https://pipeline.monroeresidential.com.

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:4321
pnpm test           # unit tests
pnpm test:e2e       # builds + Playwright
pnpm data:check     # validate data/projects.csv and print totals
```

## Updating project data

1. Edit `data/projects.csv` (one row per project; see column rules below).
2. Update `DATA_AS_OF` in `src/lib/data-meta.ts`.
3. New address? Leave `lat`/`lng` empty and run `pnpm geocode`, then check the pin on the map.
4. `pnpm data:check` must pass. Push to `main` to deploy.

Column rules: `status` ∈ completed | under_construction | permitted | approved | planning;
`program` ∈ lasalle | private; `confidence` ∈ dpd | reported; `sources` are URLs separated by ` | `;
numbers are plain digits (no `$`, `~`, commas); empty cells mean unknown.

## Map tiles

Basemap tiles are served from Cloudflare R2 (bucket `chicago-pipeline-tiles`) at
https://tiles.monroeresidential.com/chicago.pmtiles, for both production and local dev.
To refresh them from the latest Protomaps daily build:

```bash
mkdir -p tiles
gh release download --repo protomaps/go-pmtiles --pattern '*Darwin_arm64.zip' --dir tiles
unzip -o tiles/*Darwin_arm64.zip -d tiles/bin
BUILD=$(curl -s https://build-metadata.protomaps.dev/builds.json | python3 -c 'import sys,json;print(json.load(sys.stdin)[-1]["key"])')
tiles/bin/pmtiles extract "https://build.protomaps.com/$BUILD" tiles/chicago.pmtiles --bbox=-87.78,41.80,-87.56,41.97 --maxzoom=15
pnpm exec wrangler r2 object put chicago-pipeline-tiles/chicago.pmtiles --file tiles/chicago.pmtiles --remote --content-type application/octet-stream
```
