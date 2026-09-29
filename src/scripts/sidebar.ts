import type { FilterState, SortKey } from "../lib/filters";
import { formatMoney, formatUnits } from "../lib/format";
import { PROGRAMS, STATUSES } from "../lib/schema";
import type { Totals } from "../lib/stats";

function checkedValues(root: ParentNode, name: string): string[] {
  return [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value);
}

export function readFilters(root: ParentNode): Pick<FilterState, "statuses" | "programs"> {
  const statuses = checkedValues(root, "status");
  const programs = checkedValues(root, "program");
  return {
    statuses: STATUSES.filter((s) => statuses.includes(s)),
    programs: PROGRAMS.filter((p) => programs.includes(p)),
  };
}

export function writeFilters(root: ParentNode, state: FilterState): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="status"], input[name="program"]')) {
    const values: readonly string[] = input.name === "status" ? state.statuses : state.programs;
    input.checked = values.includes(input.value);
  }
}

export function readSort(root: ParentNode): SortKey {
  const value = root.querySelector<HTMLSelectElement>("#sort")?.value;
  return value === "tpc" || value === "status" ? value : "units";
}

export function renderStats(root: ParentNode, t: Totals): void {
  const text: Record<string, string> = { count: String(t.count), units: formatUnits(t.units), tpc: formatMoney(t.tpcMusd) };
  for (const el of root.querySelectorAll<HTMLElement>("[data-stat]")) {
    const next = text[el.dataset.stat!] ?? "";
    // Rewriting identical text creates a new paint, which Lighthouse then counts as the page's LCP.
    if (el.textContent !== next) el.textContent = next;
  }
}

export function renderList(root: ParentNode, visibleIds: ReadonlySet<string>, selected: string | null): void {
  for (const item of root.querySelectorAll<HTMLLIElement>("#project-list > li[data-id]")) {
    const id = item.dataset.id!;
    item.hidden = !visibleIds.has(id);
    item.classList.toggle("is-selected", id === selected);
  }
  root.querySelector<HTMLElement>("#empty-state")!.hidden = visibleIds.size > 0;
}

export function applyOrder(root: ParentNode, order: readonly string[]): void {
  const list = root.querySelector<HTMLOListElement>("#project-list")!;
  for (const id of order) {
    const item = list.querySelector(`:scope > li[data-id="${id}"]`);
    if (item) list.append(item);
  }
}

export function scrollRowIntoView(root: ParentNode, id: string): void {
  root.querySelector(`#project-list > li[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function bindSheet(sidebar: HTMLElement): { collapse(): void } {
  const handle = sidebar.querySelector<HTMLButtonElement>(".sheet-handle")!;
  const set = (expanded: boolean) => {
    sidebar.dataset.state = expanded ? "expanded" : "collapsed";
    handle.setAttribute("aria-expanded", String(expanded));
  };
  handle.addEventListener("click", () => set(sidebar.dataset.state !== "expanded"));
  return { collapse: () => set(false) };
}
