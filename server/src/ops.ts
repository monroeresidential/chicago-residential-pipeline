import type { Principal } from "./auth/tokens";
import { withActor } from "./db/actor";
import type { Db } from "./db/client";
import { HttpError } from "./errors";
import type { AppDeps } from "./http/app";
import { suggestProjects } from "./match/suggest";
import { markChanged, markDirty, trackPublic } from "./publish/state";
import { publishNow } from "./publish/trigger";
import { getAsOf, listProjects, projectStats } from "./read/public";
import { getQueueItem, listQueue, queueSummary, type QueueFilter } from "./review/queue";
import { approveItem, bulkReview, rejectItem, type ApproveOptions, type BulkReviewRequest } from "./review/review";
import { linkFiling, setFilingDeleted, unlinkFiling, updateFilingRecord } from "./store/edit";
import { loadFilingRecord } from "./store/filings";
import { listHistory, revertTo, type HistoryTable, type Revertible } from "./store/history";
import { mergeValues } from "./store/merge";
import { createProjectRow, setProjectDeleted, updateProjectRow, type ProjectCreate, type ProjectPatchInput } from "./store/projects";
import { getFiling, searchFilings, type FilingSearch } from "./store/search";
import { toFeatureCollection } from "../../src/lib/geojson";

export function createOps({ db, config }: AppDeps) {
  const edit = <T>(p: Principal, fn: (q: Db) => Promise<T>) => withActor(db, p.sub, "admin_edit", fn);
  return {
    // public
    listProjects: (opts: { includeFilings?: boolean; includeDrafts?: boolean } = {}) => listProjects(db, opts),
    getProject: async (id: string, includeDrafts = false) => {
      const [p] = await listProjects(db, { ids: [id], includeFilings: true, includeDrafts });
      if (!p) throw new HttpError(404, `no project ${id}`);
      return p;
    },
    stats: async () => projectStats(await listProjects(db)),
    geojson: async () => toFeatureCollection(await listProjects(db), await getAsOf(db)),
    asOf: () => getAsOf(db),
    // queue
    queueSummary: () => queueSummary(db),
    listQueue: (filter: Partial<QueueFilter>, page?: { limit?: number; offset?: number }) => listQueue(db, filter, page),
    getQueueItem: (id: number) => getQueueItem(db, id),
    approve: (p: Principal, id: number, opts?: ApproveOptions) => approveItem(db, p.sub, id, opts),
    reject: (p: Principal, id: number, reason: string) => rejectItem(db, p.sub, id, reason),
    bulkReview: (p: Principal, req: BulkReviewRequest) => bulkReview(db, p.sub, req),
    // records
    searchFilings: (s: FilingSearch) => searchFilings(db, s),
    getFiling: (id: number) => getFiling(db, id),
    matchCandidates: async (id: number) => suggestProjects(db, await loadFilingRecord(db, (await getFiling(db, id)).id)),
    link: (p: Principal, projectId: string, filingId: number) => edit(p, async (q) => {
      await linkFiling(q, projectId, filingId, p.sub, "linked by editor");
      await markChanged(q, { projectIds: [projectId] });
    }),
    unlink: (p: Principal, projectId: string, filingId: number) => edit(p, (q) =>
      trackPublic(q, { projectIds: [projectId] }, () => unlinkFiling(q, projectId, filingId))),
    createProject: (p: Principal, input: ProjectCreate) => edit(p, async (q) => {
      await createProjectRow(q, input);
      await markChanged(q, { projectIds: [input.id] });
      return { id: input.id };
    }),
    updateProject: (p: Principal, id: string, patch: ProjectPatchInput) => edit(p, (q) => trackPublic(q, { projectIds: [id] }, () => updateProjectRow(q, id, patch))),
    deleteProject: (p: Principal, id: string) => edit(p, (q) => trackPublic(q, { projectIds: [id] }, () => setProjectDeleted(q, id, true))),
    restoreProject: (p: Principal, id: string) => edit(p, (q) => trackPublic(q, { projectIds: [id] }, () => setProjectDeleted(q, id, false))),
    updateFiling: (p: Principal, id: number, patch: Record<string, unknown>) => edit(p, (q) => trackPublic(q, { filingIds: [id] }, () => updateFilingRecord(q, id, patch))),
    deleteFiling: (p: Principal, id: number) => edit(p, (q) => trackPublic(q, { filingIds: [id] }, () => setFilingDeleted(q, id, true))),
    restoreFiling: (p: Principal, id: number) => edit(p, (q) => trackPublic(q, { filingIds: [id] }, () => setFilingDeleted(q, id, false))),
    merge: (p: Principal, type: "organization" | "address", fromId: number, intoId: number) =>
      withActor(db, p.sub, `merge:${type}:${fromId}->${intoId}`, async (q) => {
        const r = await mergeValues(q, type, fromId, intoId);
        await markDirty(q);
        return r;
      }),
    history: (table: HistoryTable, recordId: string) => listHistory(db, table, recordId),
    revert: (p: Principal, table: Revertible, recordId: string, version: number) =>
      withActor(db, p.sub, `revert:${table}:${recordId}:${version}`, async (q) => {
        await revertTo(q, table, recordId, version);
        await markDirty(q);
      }),
    publishSite: () => publishNow(db, config),
  };
}
export type Ops = ReturnType<typeof createOps>;
