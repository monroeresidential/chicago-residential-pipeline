import { z } from "zod";
import { STATUSES } from "../../../shared/constants";
import type { Principal } from "../auth/tokens";
import type { Ops } from "../ops";
import { QueueFilterSchema } from "../review/queue";
import { ApproveOptionsSchema, BulkReviewSchema } from "../review/review";
import { HISTORY_TABLES, REVERTIBLE } from "../store/history";
import { ProjectCreateInput, ProjectPatch } from "../store/projects";
import { FilingSearchSchema } from "../store/search";

export interface ToolDef {
  name: string;
  description: string;
  tier: "public" | "editor";
  input: z.ZodObject;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (ops: Ops, p: Principal | null, args: any) => Promise<unknown>;
}

const isEditor = (p: Principal | null) => p?.role === "editor";
const me = (p: Principal | null) => p!; // editor tools are only registered for editors
const Id = z.object({ id: z.number().int().describe("numeric id") });
const ProjectId = z.object({ id: z.string().describe("project slug, e.g. 111-w-monroe") });
const Link = z.object({ project_id: z.string(), filing_id: z.number().int() });

export const TOOLS: ToolDef[] = [
  {
    name: "search_projects", tier: "public",
    description: "List Chicago office-to-residential conversion projects on chicagopipeline.com. Optional text matches id, name, address or developer; optional status filter.",
    input: z.object({ query: z.string().optional(), status: z.enum(STATUSES).optional(), include_drafts: z.boolean().optional().describe("editors only") }),
    run: async (ops, p, a) => {
      const q = a.query?.toLowerCase();
      return (await ops.listProjects({ includeDrafts: isEditor(p) && a.include_drafts === true }))
        .filter((x) => (!a.status || x.status === a.status) && (!q || [x.id, x.name, x.address, x.developer].some((v) => v?.toLowerCase().includes(q))))
        .map((x) => ({ id: x.id, name: x.name, address: x.address, status: x.status, units: x.units, developer: x.developer, tpc_musd: x.tpc_musd }));
    },
  },
  {
    name: "get_project", tier: "public",
    description: "One project with every field and its linked permits, rezonings and hearings (newest first) with official source links.",
    input: ProjectId, run: (ops, p, a) => ops.getProject(a.id, isEditor(p)),
  },
  {
    name: "pipeline_stats", tier: "public", description: "Totals for the published pipeline: project count, units, total project cost ($M) and counts by stage.",
    input: z.object({}), run: (ops) => ops.stats(),
  },
  { name: "queue_summary", tier: "editor", description: "Pending review queue counts by kind, action, match strength and blocking issues; time of Grok's last submission.", input: z.object({}), run: (ops) => ops.queueSummary() },
  {
    name: "list_queue", tier: "editor",
    description: "List queue items (default: pending) with filters. strength = top project suggestion (strong/likely/possible/none); has_issues = values that must be fixed before approval.",
    input: QueueFilterSchema.partial().extend({ limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional() }),
    run: (ops, _p, { limit, offset, ...filter }) => ops.listQueue(filter, { limit, offset }),
  },
  { name: "get_queue_item", tier: "editor", description: "Full queue item: normalized proposal, field-by-field diff, normalization issues, project suggestions with reasons, possible duplicate names/addresses.", input: Id, run: (ops, _p, a) => ops.getQueueItem(a.id) },
  {
    name: "approve", tier: "editor",
    description: "Approve a pending item. Optional: link_to a project id, or create_project (draft) from it; overrides = corrected values in Grok's field names; accept_status_change applies the suggested stage move.",
    input: ApproveOptionsSchema.extend({ id: z.number().int() }),
    run: (ops, p, { id, ...opts }) => ops.approve(me(p), id, opts),
  },
  { name: "reject", tier: "editor", description: "Reject a pending item with a reason. Identical data from Grok will not come back.", input: Id.extend({ reason: z.string() }), run: async (ops, p, a) => { await ops.reject(me(p), a.id, a.reason); return { ok: true }; } },
  {
    name: "bulk_review", tier: "editor",
    description: "Approve or reject many pending items. First call without confirm returns a count, a sample and a confirm code (valid 10 minutes); call again with the same arguments plus confirm to execute. link_strong links items that have exactly one strong project match.",
    input: BulkReviewSchema, run: (ops, p, a) => ops.bulkReview(me(p), a),
  },
  { name: "search_filings", tier: "editor", description: "Search accepted filings by text (address, case/record/permit number, organization name), kind, target area, linked or not.", input: FilingSearchSchema, run: (ops, _p, a) => ops.searchFilings(a) },
  { name: "get_filing", tier: "editor", description: "One accepted filing with all canonical values and its project links.", input: Id, run: (ops, _p, a) => ops.getFiling(a.id) },
  { name: "match_candidates", tier: "editor", description: "Projects this filing may belong to, with strength and reasons.", input: z.object({ filing_id: z.number().int() }), run: (ops, _p, a) => ops.matchCandidates(a.filing_id) },
  { name: "link", tier: "editor", description: "Link a filing to a project.", input: Link, run: async (ops, p, a) => { await ops.link(me(p), a.project_id, a.filing_id); return { ok: true }; } },
  { name: "unlink", tier: "editor", description: "Remove a filing's link to a project.", input: Link, run: async (ops, p, a) => { await ops.unlink(me(p), a.project_id, a.filing_id); return { ok: true }; } },
  { name: "create_project", tier: "editor", description: "Create a project (draft unless visibility is published). Same fields as the public project, address validated against the city street list.", input: ProjectCreateInput, run: (ops, p, a) => ops.createProject(me(p), a) },
  { name: "update_project", tier: "editor", description: "Change project fields; only the fields given change.", input: ProjectId.extend({ patch: ProjectPatch }), run: async (ops, p, a) => { await ops.updateProject(me(p), a.id, a.patch); return ops.getProject(a.id, true); } },
  { name: "update_filing", tier: "editor", description: "Correct an accepted filing using Grok's field names (re-validated and normalized).", input: Id.extend({ patch: z.record(z.string(), z.unknown()) }), run: async (ops, p, a) => { await ops.updateFiling(me(p), a.id, a.patch); return ops.getFiling(a.id); } },
  { name: "delete_project", tier: "editor", description: "Soft-delete a project (hidden everywhere, restorable).", input: ProjectId, run: async (ops, p, a) => { await ops.deleteProject(me(p), a.id); return { ok: true }; } },
  { name: "restore_project", tier: "editor", description: "Restore a soft-deleted project.", input: ProjectId, run: async (ops, p, a) => { await ops.restoreProject(me(p), a.id); return { ok: true }; } },
  { name: "delete_filing", tier: "editor", description: "Soft-delete a filing (restorable).", input: Id, run: async (ops, p, a) => { await ops.deleteFiling(me(p), a.id); return { ok: true }; } },
  { name: "restore_filing", tier: "editor", description: "Restore a soft-deleted filing.", input: Id, run: async (ops, p, a) => { await ops.restoreFiling(me(p), a.id); return { ok: true }; } },
  {
    name: "merge", tier: "editor", description: "Merge two spellings of the same organization or address: every reference moves to into_id; future data in the old spelling resolves to it.",
    input: z.object({ type: z.enum(["organization", "address"]), from_id: z.number().int(), into_id: z.number().int() }),
    run: (ops, p, a) => ops.merge(me(p), a.type, a.from_id, a.into_id),
  },
  { name: "history", tier: "editor", description: "Every version of a record with who changed it and why. record_id: project slug, filing id, or 'project_id:filing_id' for links.", input: z.object({ table: z.enum(HISTORY_TABLES), record_id: z.string() }), run: (ops, _p, a) => ops.history(a.table, a.record_id) },
  { name: "revert", tier: "editor", description: "Put a project, filing or link back to how it was right after a version (recorded as a new version).", input: z.object({ table: z.enum(REVERTIBLE), record_id: z.string(), version: z.number().int().min(1) }), run: async (ops, p, a) => { await ops.revert(me(p), a.table, a.record_id, a.version); return { ok: true }; } },
  { name: "publish_site", tier: "editor", description: "Rebuild chicagopipeline.com now instead of waiting for the 10-minute quiet period.", input: z.object({}), run: async (ops) => ({ result: await ops.publishSite() }) },
];
