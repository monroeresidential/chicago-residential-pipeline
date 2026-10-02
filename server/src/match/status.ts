import { STATUSES, type Status } from "../../../shared/constants";
import type { NormalizedRecord } from "../../../shared/records/types";

export interface StatusChange { from: Status; to: Status; reason: string }

const ORDER = [...STATUSES].reverse(); // planning → approved → permitted → under_construction → completed

/** Forward-only stage move implied by a filing; null when the filing implies nothing new. */
export function suggestStatusChange(current: Status, record: NormalizedRecord): StatusChange | null {
  let to: Status | null = null;
  let reason = "";
  const status = record.status ?? "";
  if (record.kind === "zoning_matter" && /passed|approved|adopted/i.test(status)) {
    to = "approved"; reason = `zoning matter ${record.source_key}: ${status}`;
  } else if (record.kind === "zba_case" && /approved|granted/i.test(status)) {
    to = "approved"; reason = `ZBA case ${record.source_key}: ${status}`;
  } else if (record.kind === "permit" && record.attributes.classification === "qualifying_20plus") {
    to = "permitted"; reason = `building permit ${record.source_key} issued ${record.event_date ?? ""}`.trim();
  }
  if (!to || ORDER.indexOf(to) <= ORDER.indexOf(current)) return null;
  return { from: current, to, reason };
}
