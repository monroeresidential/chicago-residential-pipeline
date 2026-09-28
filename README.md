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
