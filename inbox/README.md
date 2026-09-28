# Inbox — upcoming project PDFs

Drop PDFs (zoning filings, offering memos, press, permit printouts) here.

**This folder is git-ignored except for this README.** The repo is public, so PDFs
placed here never leave your machine. Only the facts you approve go into
`data/projects.csv`, which *is* published.

## Workflow

1. Save the PDF here, ideally named by address, e.g. `620-n-lasalle-zoning.pdf`.
2. Ask Claude: "process the inbox". For each PDF it will propose a row for
   `data/projects.csv` (address, units, developer, status, cost, source URL) and wait
   for your OK. Anything not yet public stays out, or goes in with only what you approve.
3. After the row is added, the PDF moves to `inbox/processed/`, which is also git-ignored.

Every published project needs at least one public source URL. If a project has none yet
(for example, one of ours in zoning), we use the developer's site, as with 620 N LaSalle.
