# Idea: letting AI agents submit map updates as PRs

**Status:** discussion notes (2026-09-29) — no code written, no decisions made yet.

## Goal
Let LLMs/agents (Claude and others) propose updates to the map data — new projects, status changes — and
have them land as reviewable GitHub PRs, ideally without the agent needing a GitHub account. Nothing goes
live without Monroe's review; merges to `main` auto-deploy.

## What already exists
- All map data in one validated file, `data/projects.csv` (Zod schema; build fails on bad rows).
- CI on every PR (data check, type check, unit + e2e tests); Workers Builds previews on PRs.
- Public repo; merges to `main` deploy automatically.
- A Worker already runs in front of the site (`src/worker.ts`, redirects) — natural home for an API route.
- Formspree suggestion form (`https://formspree.io/f/maenaqbd`) documented in `llms.txt`.

## Options discussed
1. **Agents open normal PRs (needs a GitHub account).** Fork → edit CSV → PR. Needs `AGENTS.md` /
   `CONTRIBUTING.md` with column rules, a PR template, and a pointer in `llms.txt`. Downsides: public PRs,
   noise.
2. **Claude Code GitHub Action.** Trusted people comment `@claude …` on an issue; Claude drafts the PR.
   Costs Anthropic API usage; must only respond to trusted users (prompt-injection risk on a public repo);
   never allowed to merge.
3. **Scheduled agent (with the Phase 2 scrapers).** Weekly job checks permits/news/Formspree and opens PRs
   for approval.
4. **PR proxy endpoint (no GitHub account needed)** — the preferred direction so far:
   ```
   agent ──POST /api/changes (JSON)──▶ Worker
      rate limit · size caps · required public source URL
      validate with the same Zod schema as the build
      apply the change to data/projects.csv in code (no LLM editing files)
      GitHub App bot → branch + commit + PR labeled "agent-submitted"
   ──▶ CI ──▶ human review ──▶ merge ──▶ auto-deploy
   ```
   Example body:
   ```json
   { "project": "70-e-lake",
     "changes": { "status": "permitted", "status_note": "Reno permit issued Sep 2026" },
     "sources": ["https://…"],
     "submitter": { "name": "…", "contact": "optional" },
     "reason": "Permit issued last week" }
   ```
   `"project": "new"` + full fields adds a project. Response: PR URL, or exact validation errors.

## Guardrails (any option)
- Branch protection on `main`: PR required, CI must pass, 1 approving review, no direct pushes
  (direct pushes are currently allowed).
- `CODEOWNERS`: changes to `data/projects.csv` need Monroe approval.
- External/agent PRs may only touch `data/projects.csv` (CI check fails anything else).
- Public sources only; never numbers from confidential decks (`private/`).
- Fork PRs run CI without secrets (safe).
- GitHub App scoped to this repo, contents + pull requests only; cannot merge.

## Key trade-off: public PRs
Anonymous submissions would appear as public PRs (spam/wrong info visible even if never merged).
- **A.** Open a PR immediately for every valid submission (simple, transparent, noisy if abused).
- **B.** Private queue first (Cloudflare D1); Monroe/Claude approves ("approve #12"); only then the bot
  opens the PR. Nothing unreviewed goes public.
- Leaning: **B for anonymous, A for trusted API keys.**

## Optional
Plain-English suggestions → server calls Claude to convert to a structured change → same validation
(model output is only a proposed field change, so injection risk stays contained). Small API cost.

## Open questions
1. Anonymous submissions: open PRs immediately (A) or private queue first (B)?
2. Structured JSON only, or also plain-English suggestions converted by Claude?
3. API keys for Monroe's own agents/scrapers with higher limits — and eventually auto-merge for small,
   CI-passing data-only changes, or always human review?
4. Who may submit: Monroe + own agents only, or anyone?
5. Scope: project data only, or also page copy (e.g. About)?

## Suggested sequence
1. Branch protection + `CODEOWNERS` + `AGENTS.md` + PR template + `llms.txt` pointer (cheap, makes option 1 safe).
2. PR proxy endpoint (option 4) with GitHub App, rate limiting, and the chosen A/B queue model.
3. Claude GitHub Action for trusted team members (option 2).
4. Scheduled agent with the scrapers (option 3); MCP server wraps the same endpoint.
