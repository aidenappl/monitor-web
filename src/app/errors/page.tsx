"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "@/components/issue/IssueStatusBadge";
import Spinner from "@/components/Spinner";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<IssueStatus | "all">("unresolved");
  const [service, setService] = useState("");
  const [search, setSearch] = useState("");
  const [hasPR, setHasPR] = useState<"" | "true" | "false">("");
  const [sort, setSort] = useState<SortKey>("last_seen");
  const [view, setView] = useState<"list" | "board">("list");
  const [offset, setOffset] = useState(0);

  const [repos, setRepos] = useState<ServiceRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bumped to force a refetch without changing any filter (the Refresh button,
  // and reloading after a bulk update).
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Applies a filter change and resets the things that change with it.
   *
   * Pagination and selection reset here, in the event that caused them, rather
   * than in an effect watching the filters — an effect would fire a second
   * render pass for something already known at the moment of the click.
   */
  const changeFilter = (apply: () => void) => {
    apply();
    setOffset(0);
    setSelected(new Set());
    setLoading(true);
  };

  /** Paging keeps the filters but moves the window, so offset is set directly. */
  const goToOffset = (next: number) => {
    setOffset(Math.max(0, next));
    setSelected(new Set());
    setLoading(true);
  };

  const reload = () => {
    setLoading(true);
    setReloadToken((t) => t + 1);
  };

  // Debounced so typing in the search box does not fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetching lives in the effect rather than behind a useCallback so the
  // cancellation flag can be scoped to a single run. Every setState happens
  // AFTER the first await, which keeps the effect body free of synchronous
  // state updates and their cascading renders.
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
        // The board renders every column from one fetch, so it needs the
        // whole filtered set rather than a page of it.
        limit: view === "board" ? 500 : PAGE_SIZE,
        offset: view === "board" ? 0 : offset,
      });

      // Filters can change faster than a request completes; without this an
      // earlier, slower response would overwrite a later one and the list
      // would show results for filters no longer selected.
      if (cancelled) return;

      if (!res.success) {
        setError(res.error_message || "Failed to load issues");
        setIssues([]);
      } else {
        setError(null);
        setIssues(res.data ?? []);
        // A real total from the API, not inferred from a full page — which
        // is what this page used to do, and why the last page always
        // offered a "Next".
        setTotal(res.pagination?.count ?? res.data?.length ?? 0);
      }
      setLoading(false);
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

  const bulkUpdate = async (next: IssueStatus) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const results = await Promise.all(
      ids.map((id) => reqUpdateIssue(id, { status: next })),
    );
    const failed = results.filter((r) => !r.success).length;
    if (failed > 0) {
      toast.error(`${failed} of ${ids.length} failed to update`);
    } else {
      toast.success(
        `${ids.length} issue${ids.length === 1 ? "" : "s"} updated`,
      );
    }
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Issues
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {total.toLocaleString()} issue{total === 1 ? "" : "s"}
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
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => changeFilter(() => setStatus(tab))}
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                status === tab
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {tab === "all" ? "All" : STATUS_LABELS[tab]}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, name or path…"
          className="min-w-[200px] flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />

        <select
          value={service}
          onChange={(e) => changeFilter(() => setService(e.target.value))}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={hasPR}
          onChange={(e) =>
            changeFilter(() =>
              setHasPR(e.target.value as "" | "true" | "false"),
            )
          }
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="">Any PR state</option>
          <option value="true">Has a linked PR</option>
          <option value="false">No linked PR</option>
        </select>

        <select
          value={sort}
          onChange={(e) =>
            changeFilter(() => setSort(e.target.value as SortKey))
          }
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="last_seen">Last seen</option>
          <option value="first_seen">First seen</option>
          <option value="occurrences">Occurrences</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/40">
          <span className="text-sm text-blue-900 dark:text-blue-200">
            {selected.size} selected
          </span>
          {(["in_progress", "resolved", "ignored"] as IssueStatus[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => bulkUpdate(s)}
                className="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-transparent dark:text-blue-200"
              >
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
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner />
        </div>
      ) : issues.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No issues match these filters.
        </p>
      ) : view === "board" ? (
        <Board issues={issues} />
      ) : (
        <>
          <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={selected.has(issue.id)}
                onToggle={() => toggle(issue.id)}
              />
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">
              {offset + 1}–{Math.min(offset + issues.length, total)} of{" "}
              {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => goToOffset(offset - PAGE_SIZE)}
                disabled={offset === 0}
                className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                Previous
              </button>
              <button
                onClick={() => goToOffset(offset + PAGE_SIZE)}
                disabled={offset + issues.length >= total}
                className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
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

function IssueRow({
  issue,
  selected,
  onToggle,
}: {
  issue: Issue;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start gap-3 bg-white px-3 py-2.5 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-1.5 shrink-0"
        aria-label={`Select ${issue.name}`}
      />
      <Link href={`/errors/${issue.id}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <IssueStatusBadge status={issue.status} />
          {issue.priority && <IssuePriorityBadge priority={issue.priority} />}
          <RegressionBadge count={issue.regression_count} />
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {issue.title || issue.name}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
          {issue.message}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {issue.service}
          </span>
          <span>{issue.occurrence_count.toLocaleString()} occurrences</span>
          <span>last {formatRelative(issue.last_seen)}</span>
          {issue.links && issue.links.length > 0 && (
            <span title={issue.links.map((l) => l.url).join("\n")}>
              🔗 {issue.links.length}
            </span>
          )}
          {issue.comment_count ? <span>💬 {issue.comment_count}</span> : null}
          {issue.assignee && (
            <span>@{issue.assignee.name || issue.assignee.email}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function Board({ issues }: { issues: Issue[] }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {BOARD_COLUMNS.map((column) => {
        const columnIssues = issues.filter((i) => i.status === column);
        return (
          <div
            key={column}
            className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {STATUS_LABELS[column]}
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {columnIssues.length}
              </span>
            </div>
            <ul className="space-y-2">
              {columnIssues.map((issue) => (
                <li key={issue.id}>
                  <Link
                    href={`/errors/${issue.id}`}
                    className="block rounded-md border border-zinc-200 bg-white p-2 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      {issue.priority && (
                        <IssuePriorityBadge priority={issue.priority} />
                      )}
                      <RegressionBadge count={issue.regression_count} />
                    </div>
                    <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {issue.title || issue.name}
                    </p>
                    <p className="mt-0.5 line-clamp-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {issue.message}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{issue.service}</span>
                      <span>·</span>
                      <span>{issue.occurrence_count.toLocaleString()}</span>
                      {issue.links && issue.links.length > 0 && (
                        <span>🔗 {issue.links.length}</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
              {columnIssues.length === 0 && (
                <li className="px-1 py-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
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

function formatRelative(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
