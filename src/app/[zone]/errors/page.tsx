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
import { IssueList } from "@/components/issue/IssueList";
import {
  IssueToolbar,
  SortKey,
  StatusFilter,
  STATUS_FILTERS,
} from "@/components/issue/IssueToolbar";
import {
  ButtonSpinner,
  IssueListSkeleton,
  RefetchBar,
} from "@/components/issue/IssueChrome";
import { FailureState, FailureNote } from "@/components/FailureState";
import { useZoneHref } from "@/hooks/useZoneHref";

const PAGE_SIZE = 100;

/**
 * Board columns exclude `ignored` deliberately. A board is a picture of work in
 * flight, and deliberately-muted noise should not be as prominent as the work;
 * it stays reachable through the status filter.
 */
const BOARD_COLUMNS: IssueStatus[] = ["unresolved", "in_progress", "resolved"];

export default function ErrorsPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Separate flags: there is nothing to preserve on a first load, and everything
  // to preserve on a refetch.
  const [initialLoad, setInitialLoad] = useState(true);
  const [refetching, setRefetching] = useState(false);

  const [status, setStatus] = useState<StatusFilter>("unresolved");
  const [service, setService] = useState("");
  const [search, setSearch] = useState("");
  const [hasPR, setHasPR] = useState<"" | "true" | "false">("");
  const [sort, setSort] = useState<SortKey>("last_seen");
  const [view, setView] = useState<"list" | "board">("list");
  const [offset, setOffset] = useState(0);

  const [repos, setRepos] = useState<ServiceRepo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [reposToken, setReposToken] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reload = () => {
    setRefetching(true);
    setReloadToken((t) => t + 1);
  };

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

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
        // The activity strip is the point of the row, so the list asks for it.
        history: true,
        // The board renders every column from one fetch.
        limit: view === "board" ? 500 : PAGE_SIZE,
        offset: view === "board" ? 0 : offset,
      });

      // Filters change faster than requests complete; without this an earlier,
      // slower response overwrites a later one.
      if (cancelled) return;

      if (!res.success) {
        setError(res.error_message || "Could not load issues");
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
      if (cancelled) return;
      if (!res.success) {
        // Not fatal — the service filter still lists every service the loaded
        // issues mention, so the page works. But a service that exists only in
        // the repo mapping drops out of the dropdown, and a missing option reads
        // as "that service has no errors" rather than "this list is incomplete".
        setReposError(res.error_message || "The request failed.");
        return;
      }
      setReposError(null);
      setRepos(res.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reposToken]);

  const services = useMemo(() => {
    const set = new Set<string>(repos.map((r) => r.service));
    issues.forEach((i) => set.add(i.service));
    return Array.from(set).sort();
  }, [repos, issues]);

  const bulkUpdate = async (next: IssueStatus) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setBulkBusy(true);
    // Applied locally first so rows respond on click; the refetch below is the
    // source of truth and this only removes the dead air before it lands.
    setIssues((prev) =>
      prev.map((i) => (selected.has(i.id) ? { ...i, status: next } : i)),
    );

    const results = await Promise.all(
      ids.map((id) => reqUpdateIssue(id, { status: next })),
    );
    const failed = results.filter((r) => !r.success).length;
    setBulkBusy(false);

    const label = STATUS_FILTERS.find((f) => f.value === next)?.label ?? next;
    if (failed > 0)
      toast.error(`${failed} of ${ids.length} could not be updated`);
    else toast.success(`${ids.length} marked ${label}`);

    setSelected(new Set());
    reload();
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className="mx-auto max-w-8xl px-4 pb-10 sm:px-6 lg:px-8">
      {/* Sticky so the filters stay reachable down a hundred rows — scrolling
          back to the top to change a status is the main cost of a long list. */}
      <div className="sticky top-0 z-10 -mx-4 bg-zinc-950/85 px-4 pb-2 pt-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <header className="flex items-baseline justify-between gap-3 pb-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-100">
              Issues
            </h1>
            <span className="text-[13px] tabular-nums text-zinc-600">
              {total.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {reposError && (
              <FailureNote
                what="the repo list"
                message={reposError}
                onRetry={() => setReposToken((t) => t + 1)}
              />
            )}
            <button
              onClick={() =>
                changeFilter(() => setView(view === "list" ? "board" : "list"))
              }
              className="rounded-md px-2 py-1 text-[13px] text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
            >
              {view === "list" ? "Board" : "List"}
            </button>
            <button
              onClick={reload}
              className="rounded-md px-2 py-1 text-[13px] text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
            >
              Refresh
            </button>
          </div>
        </header>

        <IssueToolbar
          status={status}
          onStatus={(v) => changeFilter(() => setStatus(v))}
          search={search}
          onSearch={(v) => changeFilter(() => setSearch(v))}
          service={service}
          onService={(v) => changeFilter(() => setService(v))}
          services={services}
          hasPR={hasPR}
          onHasPR={(v) => changeFilter(() => setHasPR(v))}
          sort={sort}
          onSort={(v) => changeFilter(() => setSort(v))}
        />

        <RefetchBar active={refetching && !initialLoad} />
      </div>

      {selected.size > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-2 rounded-md border border-blue-500/25 bg-blue-500/[0.07] px-2.5 py-1.5">
          <span className="text-[13px] text-blue-200">
            {selected.size} selected
          </span>
          {(["in_progress", "resolved", "ignored"] as IssueStatus[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => bulkUpdate(s)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-blue-200 transition-colors hover:bg-blue-500/15 disabled:opacity-50"
              >
                {bulkBusy && <ButtonSpinner />}
                {STATUS_FILTERS.find((f) => f.value === s)?.label}
              </button>
            ),
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[12px] text-blue-300/70 hover:text-blue-200"
          >
            Clear
          </button>
        </div>
      )}

      {initialLoad ? (
        <IssueListSkeleton />
      ) : error ? (
        /* DOWN, NOT EMPTY — and this branch is why it is a branch. The banner
           used to render ABOVE the list, which left `issues.length === 0` true
           underneath it: a 500 printed "Nothing open. Every error that has come
           in is triaged." directly below the error. That is c68b6c4's failure
           restated by the layout rather than by the fetch. An error and an empty
           result are mutually exclusive readings, so they are mutually exclusive
           branches. */
        <FailureState what="issues" message={error} onRetry={reload} />
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
        <Board issues={issues} />
      ) : (
        <>
          <IssueList
            issues={issues}
            showStatus={status === "all"}
            selected={selected}
            onToggle={toggle}
            dimmed={refetching}
          />

          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className="tabular-nums text-zinc-600">
                {offset + 1}–{Math.min(offset + issues.length, total)} of{" "}
                {total.toLocaleString()}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => goToOffset(offset - PAGE_SIZE)}
                  disabled={offset === 0}
                  className="rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-white/[0.04] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToOffset(offset + PAGE_SIZE)}
                  disabled={offset + issues.length >= total}
                  className="rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-white/[0.04] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Board({ issues }: { issues: Issue[] }) {
  const zoned = useZoneHref();
  return (
    // Horizontal scroll on narrow screens: three columns squeezed onto a phone
    // are three unreadable columns.
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
      {BOARD_COLUMNS.map((column) => {
        const columnIssues = issues.filter((i) => i.status === column);
        const label =
          STATUS_FILTERS.find((f) => f.value === column)?.label ?? column;
        const dot =
          column === "unresolved"
            ? "bg-rose-400"
            : column === "in_progress"
              ? "bg-amber-400"
              : "bg-emerald-400";

        return (
          <section key={column} className="w-[85vw] shrink-0 sm:w-auto">
            <h2 className="mb-1.5 flex items-center gap-2 px-0.5 text-[13px] text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
              {label}
              <span className="tabular-nums text-zinc-600">
                {columnIssues.length}
              </span>
            </h2>
            <ul className="space-y-1">
              {columnIssues.map((issue) => (
                <li key={issue.id}>
                  <Link
                    href={zoned(`/errors/${issue.id}`)}
                    className="block rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
                  >
                    <p className="line-clamp-2 text-[13px] leading-5 text-zinc-100">
                      {issue.title || issue.message || issue.name}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="truncate text-indigo-400">
                        {issue.service}
                      </span>
                      <span className="ml-auto tabular-nums">
                        {issue.occurrence_count}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
              {columnIssues.length === 0 && (
                <li className="px-1 py-5 text-center text-[12px] text-zinc-700">
                  Nothing here
                </li>
              )}
            </ul>
          </section>
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
  status: StatusFilter;
  filtered: boolean;
  onClear: () => void;
}) {
  return (
    <div className="border-y border-white/[0.06] py-16 text-center">
      <p className="text-[13px] text-zinc-500">
        {filtered
          ? "Nothing matches these filters."
          : status === "unresolved"
            ? "Nothing open. Every error that has come in is triaged."
            : "Nothing here."}
      </p>
      {filtered && (
        <button
          onClick={onClear}
          className="mt-1.5 text-[13px] text-blue-400 transition-colors hover:text-blue-300"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
