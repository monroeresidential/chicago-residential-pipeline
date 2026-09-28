# Inbox — upcoming project PDFs

Drop PDFs (zoning filings, offering memos, test fits, press, permit printouts) here.

**This folder is git-ignored except for this README.** The repo is public, so PDFs placed here
never leave your machine. Only facts that are already public (and that you approve) go into
`data/projects.csv`, which *is* published.

## Workflow

1. Save the PDF here.
2. Ask Claude: "process the inbox". For each PDF it will:
   - extract everything (terms, unit mix, budget, rents, assumptions, comps, team) into the
     git-ignored `private/` folder — see `private/README.md`;
   - check what is already public, and propose a row for `data/projects.csv` using **only public
     facts**, then wait for your OK;
   - move the PDF to `private/deals/<project-id>/source.pdf`.

Every published project needs at least one public source URL. Confidential numbers (price,
budget, rents, returns) never go on the site.
