"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  reqListIssues,
  reqListServiceRepos,
  reqUpdateIssue,
} from "@/services/api";
import { Issue, IssueStatus, ServiceRepo } from "@/types";
import {
  IssuePriorityBadge,
  IssueStatusBadge,
  RegressionBadge,
  STATUS_LABELS,
  STATUS_RAIL,
} from "@/components/issue/IssueStatusBadge";
import {
  ButtonSpinner,
  IssueListSkeleton,
  RefetchBar,
  VolumeBar,
  plural,
} from "@/components/issue/IssueChrome";

const PAGE_SIZE = 100;

/**
 * Board columns exclude `ignored` deliberately.
 *
 * A board is a picture of work in flight, and ignored issues are explicitly not
 * that — giving them a column would make deliberately-muted noise as visually
 * prominent as the work. They stay reachable through the status filter.
 */
const BOARD_COLUMNS: IssueStatus[] = ["unresolved", "in_progress", "resolved"];
const STATUS_TABS: (IssueStatus | "all")[] = [
  "unresolved",
  "in_progress",
  "resolved",
  "ignored",
  "all",
];

type SortKey = "last_seen" | "first_seen" | "occurrences";

export default function ErrorsPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // `initialLoad` drives the skeleton; `refetching` drives the top bar. They are
  // separate because the two deserve different treatment — there is nothing to
  // preserve on a first load, and everything to preserve on a refetch.
  const [initialLoad, setInitialLoad] = useState(true);
  const [refetching, setRefetching] = useState(false);

  const [status, setStatus] = useState<IssueStatus | "all">("unresolved");
  const [service, setService] = useState("");
  const [search, setSearch] = useState("");
  const [hasPR, setHasPR] = useState<"" | "true" | "false">("");
  const [sort, setSort] = useState<SortKey>("last_seen");
  const [view, setView] = useState<"list" | "board">("list");
  const [offset, setOffset] = useState(0);

  const [repos, setRepos] = useState<ServiceRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);

  const changeFilter = (apply: () => void) => {
    apply();
    setOffset(0);
    setSelected(new Set());
    setRefetching(true);
  };

  const goToOffset = (next: number) => {
    setOffset(Math.max(0, next));
    setSelected(new Set());
    setRefetching(true);
    // Paging moves you to a different part of a list you read top-down; staying
    // scrolled halfway down loses that place.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reload = () => {
    setRefetching(true);
    setReloadToken((t) => t + 1);
  };

  // Debounced so typing does not fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // "/" focuses search from anywhere. This is a triage surface, and reaching for
  // the mouse to filter is the slowest part of scanning it.
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
      if (e.key === "Escape" && el === searchRef.current) {
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const res = await reqListIssues({
        status: status === "all" ? undefined : status,
        service: service || undefined,
        q: debouncedSearch || undefined,
        has_pr: hasPR === "" ? undefined : hasPR === "true",
        sort,
        order: "desc",
        // The board renders every column from one fetch, so it needs the whole
        // filtered set rather than a page of it.
        limit: view === "board" ? 500 : PAGE_SIZE,
        offset: view === "board" ? 0 : offset,
      });

      // Filters can change faster than a request completes; without this an
      // earlier, slower response would overwrite a later one and the list would
      // show results for filters no longer selected.
      if (cancelled) return;

      if (!res.success) {
        setError(res.error_message || "Failed to load issues");
        setIssues([]);
      } else {
        setError(null);
        setIssues(res.data ?? []);
        setTotal(res.pagination?.count ?? res.data?.length ?? 0);
      }
      setInitialLoad(false);
      setRefetching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    status,
    service,
    debouncedSearch,
    hasPR,
    sort,
    view,
    offset,
    reloadToken,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await reqListServiceRepos();
      if (!cancelled && res.success) setRepos(res.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const services = useMemo(() => {
    const set = new Set<string>(repos.map((r) => r.service));
    issues.forEach((i) => set.add(i.service));
    return Array.from(set).sort();
  }, [repos, issues]);

  // Scale for the volume bars, recomputed per page so the rail uses its full
  // range rather than being flattened by one historic outlier.
  const maxOccurrences = useMemo(
    () => Math.max(1, ...issues.map((i) => i.occurrence_count)),
    [issues],
  );

  const bulkUpdate = async (next: IssueStatus) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setBulkBusy(true);
    // Applied locally first so the rows respond on click. The refetch below is
    // the source of truth; this only removes the dead air before it lands.
    setIssues((prev) =>
      prev.map((i) => (selected.has(i.id) ? { ...i, status: next } : i)),
    );

    const results = await Promise.all(
      ids.map((id) => reqUpdateIssue(id, { status: next })),
    );
    const failed = results.filter((r) => !r.success).length;
    setBulkBusy(false);

    if (failed > 0)
      toast.error(`${failed} of ${ids.length} could not be updated`);
    else
      toast.success(
        `${plural(ids.length, "issue")} marked ${STATUS_LABELS[next]}`,
      );

    setSelected(new Set());
    reload();
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected =
    issues.length > 0 && issues.every((i) => selected.has(i.id));

  return (
    <main className="mx-auto max-w-8xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Issues
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {plural(total, "issue")}
            {status !== "all" ? ` · ${STATUS_LABELS[status]}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle
            view={view}
            onChange={(v) => changeFilter(() => setView(v))}
          />
          <button
            onClick={reload}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Scrolls horizontally rather than wrapping on narrow screens — a filter
          bar that reflows to four rows pushes the list off the fold. */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <div className="flex shrink-0 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => changeFilter(() => setStatus(tab))}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors ${
                status === tab
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {tab === "all" ? "All" : STATUS_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="relative min-w-[180px] flex-1 sm:min-w-[220px]">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message, name or path"
            className="w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-2.5 pr-8 text-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          {search ? (
            <button
              onClick={() => changeFilter(() => setSearch(""))}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear search"
            >
              ×
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-300 px-1 text-[10px] text-zinc-400 sm:block dark:border-zinc-700">
              /
            </kbd>
          )}
        </div>

        <Select
          value={service}
          onChange={(v) => changeFilter(() => setService(v))}
          options={[
            { value: "", label: "All services" },
            ...services.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Select
          value={hasPR}
          onChange={(v) =>
            changeFilter(() => setHasPR(v as "" | "true" | "false"))
          }
          options={[
            { value: "", label: "Any PR state" },
            { value: "true", label: "Has a PR" },
            { value: "false", label: "No PR" },
          ]}
        />
        <Select
          value={sort}
          onChange={(v) => changeFilter(() => setSort(v as SortKey))}
          options={[
            { value: "last_seen", label: "Last seen" },
            { value: "first_seen", label: "First seen" },
            { value: "occurrences", label: "Occurrences" },
          ]}
        />
      </div>

      <RefetchBar active={refetching && !initialLoad} />

      {selected.size > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/40">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
            {plural(selected.size, "issue")} selected
          </span>
          {(["in_progress", "resolved", "ignored"] as IssueStatus[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => bulkUpdate(s)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-transparent dark:text-blue-200 dark:hover:bg-blue-900/40"
              >
                {bulkBusy && <ButtonSpinner />}
                Mark {STATUS_LABELS[s]}
              </button>
            ),
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-blue-700 hover:underline dark:text-blue-300"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}{" "}
          <button onClick={reload} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      <div className="mt-3">
        {initialLoad ? (
          <IssueListSkeleton />
        ) : issues.length === 0 ? (
          <EmptyState
            status={status}
            filtered={Boolean(service || debouncedSearch || hasPR)}
            onClear={() =>
              changeFilter(() => {
                setService("");
                setSearch("");
                setHasPR("");
              })
            }
          />
        ) : view === "board" ? (
          <Board issues={issues} maxOccurrences={maxOccurrences} />
        ) : (
          <>
            {/* Dimmed rather than replaced during a refetch, so you keep your
                place and the list does not flash between filter changes. */}
            <div
              className={`transition-opacity ${refetching ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-3 px-3 pb-1.5">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={() =>
                    setSelected(
                      allOnPageSelected
                        ? new Set()
                        : new Set(issues.map((i) => i.id)),
                    )
                  }
                  className="h-3.5 w-3.5"
                  aria-label="Select all on this page"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {allOnPageSelected
                    ? "Clear selection"
                    : "Select all on this page"}
                </span>
              </div>

              <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {issues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    showStatus={status === "all"}
                    maxOccurrences={maxOccurrences}
                    selected={selected.has(issue.id)}
                    onToggle={() => toggle(issue.id)}
                  />
                ))}
              </ul>
            </div>

            {total > PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {offset + 1}–{Math.min(offset + issues.length, total)} of{" "}
                  {total.toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => goToOffset(offset - PAGE_SIZE)}
                    disabled={offset === 0}
                    className="rounded-md border border-zinc-300 px-3 py-1 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => goToOffset(offset + PAGE_SIZE)}
                    disabled={offset + issues.length >= total}
                    className="rounded-md border border-zinc-300 px-3 py-1 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-700 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "list" | "board";
  onChange: (v: "list" | "board") => void;
}) {
  return (
    <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
      {(["list", "board"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-sm capitalize transition-colors ${
            view === v
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/**
 * One issue.
 *
 * The MESSAGE leads, not the event name. `scraper.run.failed` is the same string
 * on a dozen rows — the message is what tells them apart, and burying it in grey
 * monospace under the name made scanning a matter of reading every second line.
 *
 * The status chip only appears on an unfiltered list. When filtered, every row
 * carries the same chip, which is a column of noise; the left rail keeps the
 * colour cue either way.
 */
function IssueRow({
  issue,
  showStatus,
  maxOccurrences,
  selected,
  onToggle,
}: {
  issue: Issue;
  showStatus: boolean;
  maxOccurrences: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={`relative flex items-start gap-3 px-3 transition-colors ${
        selected
          ? "bg-blue-50/60 dark:bg-blue-950/20"
          : "bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/40"
      }`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${STATUS_RAIL[issue.status]}`}
        aria-hidden
      />
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-3 h-3.5 w-3.5 shrink-0"
        aria-label={`Select ${issue.name}`}
      />
      <Link href={`/errors/${issue.id}`} className="min-w-0 flex-1 py-2.5">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {issue.title || issue.message || issue.name}
          </p>
          <span className="hidden shrink-0 items-center gap-2 pt-0.5 sm:flex">
            <VolumeBar count={issue.occurrence_count} max={maxOccurrences} />
            <span className="w-10 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatCount(issue.occurrence_count)}
            </span>
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          {showStatus && <IssueStatusBadge status={issue.status} />}
          {issue.priority && <IssuePriorityBadge priority={issue.priority} />}
          <RegressionBadge count={issue.regression_count} />
          <span className="font-medium text-indigo-600 dark:text-indigo-400">
            {issue.service}
          </span>
          <span className="truncate font-mono">{issue.name}</span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">
            {formatRelative(issue.last_seen)}
          </span>
          {issue.links && issue.links.length > 0 && (
            <span
              className="whitespace-nowrap"
              title={issue.links.map((l) => l.url).join("\n")}
            >
              🔗 {issue.links.length}
            </span>
          )}
          {issue.comment_count ? (
            <span className="whitespace-nowrap">💬 {issue.comment_count}</span>
          ) : null}
          {issue.assignee && (
            <span className="truncate">
              @{issue.assignee.name || issue.assignee.email}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function Board({
  issues,
  maxOccurrences,
}: {
  issues: Issue[];
  maxOccurrences: number;
}) {
  return (
    // Horizontal scroll on narrow screens: three columns squeezed onto a phone
    // are three unreadable columns.
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
      {BOARD_COLUMNS.map((column) => {
        const columnIssues = issues.filter((i) => i.status === column);
        return (
          <div
            key={column}
            className="w-[85vw] shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 p-2 sm:w-auto dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <span
                  className={`h-2 w-2 rounded-full ${STATUS_RAIL[column]}`}
                  aria-hidden
                />
                {STATUS_LABELS[column]}
              </h2>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {columnIssues.length}
              </span>
            </div>
            <ul className="space-y-2">
              {columnIssues.map((issue) => (
                <li key={issue.id}>
                  <Link
                    href={`/errors/${issue.id}`}
                    className="block rounded-md border border-zinc-200 bg-white p-2 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      {issue.priority && (
                        <IssuePriorityBadge priority={issue.priority} />
                      )}
                      <RegressionBadge count={issue.regression_count} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {issue.title || issue.message || issue.name}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="truncate font-medium text-indigo-600 dark:text-indigo-400">
                        {issue.service}
                      </span>
                      <VolumeBar
                        count={issue.occurrence_count}
                        max={maxOccurrences}
                      />
                      <span className="tabular-nums">
                        {formatCount(issue.occurrence_count)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
              {columnIssues.length === 0 && (
                <li className="px-1 py-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
                  Nothing here
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** An empty screen is an invitation to act, so it says what to do next. */
function EmptyState({
  status,
  filtered,
  onClear,
}: {
  status: IssueStatus | "all";
  filtered: boolean;
  onClear: () => void;
}) {
  if (filtered) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No issues match these filters.
        </p>
        <button
          onClick={onClear}
          className="mt-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {status === "unresolved"
          ? "Nothing open. Every error that has come in is triaged."
          : `No ${STATUS_LABELS[status === "all" ? "unresolved" : status].toLowerCase()} issues.`}
      </p>
    </div>
  );
}

/** Compact counts, so a five-figure number does not widen the column. */
function formatCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatRelative(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
