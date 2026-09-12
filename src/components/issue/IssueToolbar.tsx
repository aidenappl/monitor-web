"use client";

import { useEffect, useRef } from "react";
import { IssueStatus } from "@/types";

export type SortKey = "last_seen" | "first_seen" | "occurrences";
export type StatusFilter = IssueStatus | "all";

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  // "Open" rather than "Unresolved": it is both the default for a new issue and
  // the backlog, and "Unresolved" reads as a judgement about work not done when
  // most of these have never been looked at.
  { value: "unresolved", label: "Open" },
  { value: "in_progress", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
];

/**
 * The filter bar.
 *
 * Segmented control for status, because status is the one filter you change
 * constantly and it deserves to be one click rather than a menu. Everything else
 * is a quiet select — used occasionally, and not worth the horizontal budget of
 * a second segmented control.
 */
export function IssueToolbar({
  status,
  onStatus,
  search,
  onSearch,
  service,
  onService,
  services,
  hasPR,
  onHasPR,
  sort,
  onSort,
  counts,
}: {
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  search: string;
  onSearch: (v: string) => void;
  service: string;
  onService: (v: string) => void;
  services: string[];
  hasPR: "" | "true" | "false";
  onHasPR: (v: "" | "true" | "false") => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  /** Per-status totals, so the tabs say how much is behind each one. */
  counts?: Partial<Record<StatusFilter, number>>;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere. This is a scanning surface, and reaching
  // for the mouse to filter is the slowest part of working it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && el === searchRef.current)
        searchRef.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1">
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <button
              key={f.value}
              onClick={() => onStatus(f.value)}
              // The ACTIVE filter is the one thing on this row that has to be
              // readable — it is what says which slice of the issue list you are
              // looking at. `bg-white/[0.07] text-zinc-100` is a white tint under
              // near-white text: correct on the dark ground it was written for,
              // invisible on the default one. Paired, like the sticky header
              // above it.
              className={`group flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors ${
                active
                  ? "bg-zinc-900/[0.06] text-zinc-900 dark:bg-white/[0.07] dark:text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-900/[0.04] hover:text-zinc-700 dark:hover:bg-white/[0.04] dark:hover:text-zinc-300"
              }`}
            >
              {f.label}
              {counts?.[f.value] !== undefined && (
                <span
                  className={`tabular-nums text-[11px] ${
                    active ? "text-zinc-400" : "text-zinc-600"
                  }`}
                >
                  {counts[f.value]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative min-w-[160px] flex-1">
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter by message, name or path"
          className="w-full rounded-md border border-white/[0.08] bg-white/[0.02] py-1 pl-2.5 pr-7 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:border-blue-500/50 focus:bg-white/[0.04] focus:outline-none"
        />
        {search ? (
          <button
            onClick={() => onSearch("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 text-zinc-500 hover:text-zinc-200"
            aria-label="Clear filter"
          >
            ×
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 px-1 text-[10px] leading-4 text-zinc-600 sm:block">
            /
          </kbd>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Quiet value={service} onChange={onService} label="All services">
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Quiet>
        <Quiet
          value={hasPR}
          onChange={(v) => onHasPR(v as "" | "true" | "false")}
          label="Any PR"
        >
          <option value="true">Has a PR</option>
          <option value="false">No PR</option>
        </Quiet>
        <Quiet
          value={sort}
          onChange={(v) => onSort(v as SortKey)}
          label="Last seen"
          hideEmpty
        >
          <option value="last_seen">Last seen</option>
          <option value="first_seen">First seen</option>
          <option value="occurrences">Occurrences</option>
        </Quiet>
      </div>
    </div>
  );
}

/**
 * A select styled down to look like text until you need it.
 *
 * Three native dropdowns in a row read as a form to fill in; these are filters
 * you touch occasionally, and they should sit quietly until used.
 */
function Quiet({
  value,
  onChange,
  label,
  hideEmpty,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  hideEmpty?: boolean;
  children: React.ReactNode;
}) {
  const active = value !== "";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`cursor-pointer rounded-md border border-transparent bg-transparent py-1 pl-1.5 pr-1 text-[13px] transition-colors hover:border-white/[0.08] hover:bg-white/[0.03] focus:border-blue-500/50 focus:outline-none ${
        active ? "text-zinc-200" : "text-zinc-500"
      }`}
    >
      {!hideEmpty && <option value="">{label}</option>}
      {children}
    </select>
  );
}
