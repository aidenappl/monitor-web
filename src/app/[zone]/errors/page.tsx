"use client";

import { issueTitle } from "@/tools/issue.tools";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  BulkIssueFilter,
  ListIssuesParams,
  reqBulkUpdateIssues,
  reqListIssues,
  reqListServiceRepos,
} from "@/services/api";
import { firstError } from "@/services/api.service";
import { Issue, IssuePriority, IssueStatus, ServiceRepo } from "@/types";
import type { BulkUpdateIssuesPayload } from "@/services/api";
import { useAuth } from "@/store/hooks";
import { reqListUsers } from "@/services/admin.service";
import type { AdminUser } from "@/types/auth.types";
import {
  IssueList,
  IssueListHeader,
  Tag,
  formatCount,
  formatRelative,
} from "@/components/issue/IssueList";
import { useRole } from "@/hooks/useRole";
import {
  IssueToolbar,
  SortKey,
  SortOrder,
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
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useUrlState, urlEnum, urlInt, urlString } from "@/hooks/useUrlState";

const PAGE_SIZE = 100;
/** Per board column, per "Show more". */
const BOARD_PAGE = 50;

/**
 * Board columns exclude `ignored` deliberately. A board is a picture of work in
 * flight, and deliberately-muted noise should not be as prominent as the work;
 * it stays reachable through the status filter.
 */
const BOARD_COLUMNS: IssueStatus[] = ["unresolved", "in_progress", "resolved"];
const COUNTED_STATUSES: IssueStatus[] = ["unresolved", "in_progress", "resolved", "ignored"];

const STATUS_VALUES = STATUS_FILTERS.map((f) => f.value);
const SORT_VALUES: readonly SortKey[] = ["last_seen", "first_seen", "occurrences"];
const ORDER_VALUES: readonly SortOrder[] = ["desc", "asc"];
const VIEW_VALUES = ["list", "board"] as const;
const HAS_PR_VALUES = ["", "true", "false"] as const;

/**
 * The bulk bar's status actions. VERBS, not the tab labels: "Resolved" on the
 * bar read exactly like the "Resolved" tab forty pixels above it, so reaching
 * for the filter could resolve a page of issues.
 */
const STATUS_ACTIONS: Record<IssueStatus, { verb: string; past: string }> = {
  unresolved: { verb: "Reopen", past: "reopened" },
  in_progress: { verb: "Mark active", past: "marked active" },
  resolved: { verb: "Resolve", past: "resolved" },
  ignored: { verb: "Ignore", past: "ignored" },
};

const STATUS_CONSEQUENCE: Record<IssueStatus, string> = {
  unresolved: "They return to the Open list.",
  in_progress: "They move to Active. A recurrence will not reopen them.",
  resolved: "They leave the Open list. One that recurs reopens as a regression.",
  ignored: "They leave the Open list and stay muted when they recur.",
};

export default function ErrorsPage() {
  const { canWrite } = useRole();
  const confirm = useConfirm();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Separate flags: there is nothing to preserve on a first load, and everything
  // to preserve on a refetch.
  const [initialLoad, setInitialLoad] = useState(true);
  const [refetching, setRefetching] = useState(false);

  // Every filter lives in the URL, so Back from an issue returns to the same
  // slice of the list, a reload keeps page 3, and a pasted link shows the
  // recipient what the sender was looking at.
  const [status, setStatus] = useUrlState("status", urlEnum(STATUS_VALUES), {
    default: "unresolved",
  });
  const [service, setService] = useUrlState("service", urlString, { default: "" });
  const [search, setSearch] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
  const [hasPR, setHasPR] = useUrlState("has_pr", urlEnum(HAS_PR_VALUES), { default: "" });
  const [assignee, setAssignee] = useUrlState("assignee", urlString, { default: "" });
  const [sort, setSort] = useUrlState("sort", urlEnum(SORT_VALUES), { default: "last_seen" });
  const [order, setOrder] = useUrlState("order", urlEnum(ORDER_VALUES), { default: "desc" });
  const [view, setView] = useUrlState("view", urlEnum(VIEW_VALUES), { default: "list" });
  const [page, setPage] = useUrlState("page", urlInt, { default: 1 });
  const offset = Math.max(0, page - 1) * PAGE_SIZE;

  const [repos, setRepos] = useState<ServiceRepo[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);
  const [reposToken, setReposToken] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // `allMatching` widens the selection from the ids on this page to every issue
  // the current filter matches, across pages. It is a different request (by
  // filter, not ids), so it is a mode rather than a bigger Set.
  const [allMatching, setAllMatching] = useState(false);
  // The last row toggled without Shift — the fixed end of a Shift-click range.
  const [anchor, setAnchor] = useState<string | null>(null);
  // The j/k cursor.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    change: BulkChange;
    label: string;
    matched: number;
  } | null>(null);
  const [counts, setCounts] = useState<Partial<Record<StatusFilter, number>> | undefined>();
  const { user } = useAuth();
  const [assignees, setAssignees] = useState<AdminUser[] | null>(null);

  const clearSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
    setAnchor(null);
  };

  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
    clearSelection();
    setFocusedId(null);
    setRefetching(true);
  };

  const goToOffset = (next: number) => {
    setPage(Math.floor(Math.max(0, next) / PAGE_SIZE) + 1);
    clearSelection();
    setFocusedId(null);
    setRefetching(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reload = () => {
    setRefetching(true);
    setReloadToken((t) => t + 1);
  };

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // "me" stays "me" in the URL so a shared link opens the RECIPIENT's queue;
  // it becomes an id only on the wire. Null while the user is still loading —
  // the fetch waits rather than briefly showing everyone's issues.
  const assigneeParam: string | null | undefined =
    assignee === "me" ? (user ? String(user.id) : null) : assignee || undefined;

  // Everything but status, paging and shape: what the counts, the board and
  // "select all matching" share with the list.
  const baseFilters = useMemo<ListIssuesParams>(
    () => ({
      service: service || undefined,
      q: debouncedSearch.trim() || undefined,
      has_pr: hasPR === "" ? undefined : hasPR === "true",
      assignee: assigneeParam ?? undefined,
    }),
    [service, debouncedSearch, hasPR, assigneeParam],
  );
  const filtersReady = assigneeParam !== null;

  useEffect(() => {
    if (view !== "list" || !filtersReady) return;
    let cancelled = false;

    void (async () => {
      const res = await reqListIssues({
        ...baseFilters,
        status: status === "all" ? undefined : status,
        sort,
        order,
        // The activity strip is the point of the row, so the list asks for it.
        history: true,
        limit: PAGE_SIZE,
        offset,
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
  }, [baseFilters, filtersReady, status, sort, order, view, offset, reloadToken]);

  // Per-status totals for the tabs: one limit=1 read per status under the same
  // filters. The count is all that is wanted; pagination carries it.
  useEffect(() => {
    if (!filtersReady) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        COUNTED_STATUSES.map((s) => reqListIssues({ ...baseFilters, status: s, limit: 1 })),
      );
      if (cancelled) return;
      // Supplementary: on a failure the tabs show no numbers rather than a
      // wrong one. The list itself reports its own failure.
      if (firstError(...results)) {
        setCounts(undefined);
        return;
      }
      const next: Partial<Record<StatusFilter, number>> = {};
      let all = 0;
      COUNTED_STATUSES.forEach((s, i) => {
        const r = results[i];
        // pagination.count is absent when it is 0.
        const n = r.success ? (r.pagination?.count ?? r.data?.length ?? 0) : 0;
        next[s] = n;
        all += n;
      });
      next.all = all;
      setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [baseFilters, filtersReady, reloadToken]);

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
    // A service from a shared link with no issues on this page still needs
    // its option, or the select shows "All services" over an applied filter.
    if (service) set.add(service);
    return Array.from(set).sort();
  }, [repos, issues, service]);

  // The filter the list is showing, in the bulk endpoint's shape — null when it
  // narrows nothing, which the API refuses, so "select all matching" is not
  // offered over an unfiltered list.
  const currentFilter = useMemo<BulkIssueFilter | null>(() => {
    const f: BulkIssueFilter = {};
    if (status !== "all") f.status = status;
    if (baseFilters.service) f.service = baseFilters.service;
    if (baseFilters.q) f.q = baseFilters.q;
    if (baseFilters.has_pr !== undefined) f.has_pr = baseFilters.has_pr;
    if (baseFilters.assignee) f.assignee = baseFilters.assignee;
    return Object.keys(f).length > 0 ? f : null;
  }, [status, baseFilters]);

  const statusLabel = (s: StatusFilter) =>
    STATUS_FILTERS.find((f) => f.value === s)?.label ?? s;

  // The assignee list is admin-only on the API. Admins get it up front: it
  // names the people in the Assignee filter as well as the bulk picker.
  const isAdminUser = user?.role === "admin";
  useEffect(() => {
    if (!isAdminUser || assignees !== null) return;
    let cancelled = false;
    void reqListUsers({ limit: 500 }).then((res) => {
      if (cancelled) return;
      setAssignees(res.success ? res.data.filter((u) => u.active && u.role !== "pending") : []);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdminUser, assignees]);

  const assigneeOptions = useMemo(
    () =>
      (assignees ?? [])
        .filter((u) => u.id !== user?.id)
        .map((u) => ({ id: u.id, label: u.name || u.email })),
    [assignees, user?.id],
  );

  /**
   * Put the given issues back the way they were before a bulk change, from
   * the copy taken just before it. One bulk call per distinct prior value —
   * at most four for a status — never a PUT per issue.
   */
  const undoChange = async (change: BulkChange, before: Issue[]) => {
    const groups = new Map<string, { change: BulkChange; ids: string[] }>();
    for (const i of before) {
      let prior: BulkChange;
      if (change.status) prior = { status: i.status };
      else if (change.priority !== undefined) prior = { priority: i.priority ?? null };
      else prior = { assignee_user_id: i.assignee_user_id ?? null };
      const key = JSON.stringify(prior);
      const g = groups.get(key) ?? { change: prior, ids: [] };
      g.ids.push(i.id);
      groups.set(key, g);
    }
    const results = await Promise.all(
      Array.from(groups.values()).map((g) => reqBulkUpdateIssues({ ...g.change, ids: g.ids })),
    );
    const failed = firstError(...results);
    if (failed) toast.error(`Undo failed: ${failed.error_message || "the update was refused"}`);
    else toast.success(`Restored ${before.length} issue${before.length === 1 ? "" : "s"}`);
    reload();
  };

  /**
   * One bulk change — any of status, priority, assignee — over the selected
   * ids (or `ids` when given: the keyboard acts on the focused row) or, in
   * "all matching" mode, the current filter (dry-run, confirm, then drain).
   *
   * Every change confirms, naming the count and the target, and the ids path
   * then offers Undo: these are one click from the status tabs and change
   * regression behaviour, so a slip must be both caught and reversible.
   */
  const bulkApply = async (
    change: BulkChange,
    /** "Assign" + " to you" → "Assign 3 issues to you?" / "Assign 3 to you". */
    words: { verb: string; past: string; suffix?: string; consequence?: string },
    explicitIds?: string[],
  ) => {
    if (!explicitIds && allMatching && currentFilter) {
      // Count first: the number on the selection bar is the list total, which
      // includes issues already at the target. The dry run is the number that
      // will actually change, and that is what gets confirmed.
      setBulkBusy(true);
      const res = await reqBulkUpdateIssues({
        ...change,
        filter: currentFilter,
        dry_run: true,
      });
      setBulkBusy(false);
      if (!res.success) {
        toast.error(res.error_message || "Could not count the matching issues");
        return;
      }
      if (res.data.matched === 0) {
        toast(`Every matching issue is already ${words.past.replace(/^(marked|set to) /, "")}`);
        return;
      }
      setConfirming({ change, label: words.past, matched: res.data.matched });
      return;
    }

    const idSet = new Set(explicitIds ?? Array.from(selected));
    const ids = Array.from(idSet);
    if (ids.length === 0) return;
    const before = issues.filter((i) => idSet.has(i.id));
    const n = ids.length;
    const noun = `issue${n === 1 ? "" : "s"}`;

    const ok = await confirm({
      title: `${words.verb} ${n} ${noun}${words.suffix ?? ""}?`,
      description: `${words.consequence ? words.consequence + " " : ""}You can undo this from the notification for a few seconds.`,
      confirmLabel: `${words.verb} ${n}${words.suffix ?? ""}`,
    });
    if (!ok) return;

    setBulkBusy(true);
    // Applied locally first so rows respond on click; the refetch below is the
    // source of truth and this only removes the dead air before it lands.
    setIssues((prev) =>
      prev.map((i) =>
        idSet.has(i.id)
          ? {
              ...i,
              ...(change.status ? { status: change.status } : {}),
              ...(change.priority !== undefined ? { priority: change.priority ?? undefined } : {}),
            }
          : i,
      ),
    );

    const res = await reqBulkUpdateIssues({ ...change, ids });
    setBulkBusy(false);

    if (!res.success) {
      toast.error(res.error_message || `${n} could not be updated`);
    } else {
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            {res.data.updated} {words.past}
            <button
              type="button"
              onClick={() => {
                toast.dismiss(t.id);
                void undoChange(change, before);
              }}
              className="rounded px-1.5 py-0.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 6000 },
      );
    }

    clearSelection();
    reload();
  };

  const bulkUpdate = (next: IssueStatus, ids?: string[]) =>
    bulkApply(
      { status: next },
      { ...STATUS_ACTIONS[next], consequence: STATUS_CONSEQUENCE[next] },
      ids,
    );

  const runConfirmed = async () => {
    if (!confirming || !currentFilter) return;
    setBulkBusy(true);

    // One pass moves at most 1000 and takes them out of the match set, so
    // repeating the same request converges. The pass cap only guards against a
    // server that stops making progress.
    let updated = 0;
    let failure: string | null = null;
    for (let pass = 0; pass < 100; pass++) {
      const res = await reqBulkUpdateIssues({
        ...confirming.change,
        filter: currentFilter,
      });
      if (!res.success) {
        failure = res.error_message || "the update failed";
        break;
      }
      updated += res.data.updated;
      if (res.data.remaining === 0 || res.data.updated === 0) break;
    }

    setBulkBusy(false);
    if (failure)
      toast.error(
        updated > 0 ? `${updated} updated, then ${failure}` : failure,
      );
    else toast.success(`${updated} ${confirming.label}`);
    setConfirming(null);
    clearSelection();
    reload();
  };

  const toggle = useCallback(
    (id: string, range: boolean) => {
      setAllMatching(false);
      const ids = issues.map((i) => i.id);
      const to = ids.indexOf(id);
      const from = range && anchor ? ids.indexOf(anchor) : -1;

      setSelected((prev) => {
        const next = new Set(prev);
        if (from !== -1 && to !== -1) {
          // The whole range takes the state the clicked row is moving to, so a
          // Shift-click can clear a run as easily as it selects one.
          const select = !prev.has(id);
          const [a, b] = from < to ? [from, to] : [to, from];
          for (let k = a; k <= b; k++) {
            if (select) next.add(ids[k]);
            else next.delete(ids[k]);
          }
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!range || from === -1) setAnchor(id);
    },
    [issues, anchor],
  );

  const pageAllSelected =
    issues.length > 0 && issues.every((i) => selected.has(i.id));
  const pageSomeSelected = issues.some((i) => selected.has(i.id));

  const togglePage = () => {
    setAllMatching(false);
    setAnchor(null);
    setSelected(pageAllSelected ? new Set() : new Set(issues.map((i) => i.id)));
  };

  // Keyboard triage. j/k move a cursor down the list, x selects, Enter opens
  // (the cursor focuses the row's link, so Enter is the browser's own). e / i /
  // a act on the selection, or the cursor row when nothing is selected — and
  // go through the same confirm as the bar, so a stray key is caught.
  const keyState = useRef({ issues, focusedId, selected, canWrite, view, user });
  useEffect(() => {
    keyState.current = { issues, focusedId, selected, canWrite, view, user };
  });
  const actRef = useRef({ toggle, bulkUpdate, bulkApply });
  useEffect(() => {
    actRef.current = { toggle, bulkUpdate, bulkApply };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const s = keyState.current;
      if (s.view !== "list" || s.issues.length === 0) return;
      const idx = s.issues.findIndex((i) => i.id === s.focusedId);

      const move = (to: number) => {
        const next = s.issues[Math.max(0, Math.min(s.issues.length - 1, to))];
        setFocusedId(next.id);
        document
          .querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(next.id)}"] a`)
          ?.focus();
      };
      const targets = () =>
        s.selected.size > 0 ? undefined : s.focusedId ? [s.focusedId] : null;

      switch (e.key) {
        case "j":
          e.preventDefault();
          move(idx + 1);
          break;
        case "k":
          e.preventDefault();
          move(idx === -1 ? 0 : idx - 1);
          break;
        case "x":
          if (!s.canWrite || !s.focusedId) return;
          e.preventDefault();
          actRef.current.toggle(s.focusedId, false);
          break;
        case "e":
        case "i": {
          const t = targets();
          if (!s.canWrite || t === null) return;
          e.preventDefault();
          void actRef.current.bulkUpdate(e.key === "e" ? "resolved" : "ignored", t);
          break;
        }
        case "a": {
          const t = targets();
          if (!s.canWrite || t === null || !s.user) return;
          e.preventDefault();
          void actRef.current.bulkApply(
            { assignee_user_id: s.user.id },
            { verb: "Assign", suffix: " to you", past: "assigned to you" },
            t,
          );
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = Boolean(service || debouncedSearch || hasPR || assignee);

  return (
    <main className="mx-auto max-w-8xl px-4 pb-10 sm:px-6 lg:px-10">
      {/* Sticky so the filters stay reachable down a hundred rows — scrolling
          back to the top to change a status is the main cost of a long list.

          ⚠️ THE BACKDROP MUST TRACK THE THEME, and it did not: an unconditional
          `bg-zinc-950/85` painted a near-black band across the top of the app's
          DEFAULT theme, with `text-zinc-100` on it. Light mode is what a new
          browser profile gets, and this is the primary triage surface — the
          heading, the count and the whole filter row were white-on-white while
          the rows below them rendered correctly. Every colour on this page now
          comes in a pair; a single-value one here is a bug by construction. */}
      <div className="sticky top-0 z-10 -mx-4 bg-zinc-50/85 px-4 pb-2 pt-4 backdrop-blur dark:bg-zinc-950/85 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <header className="flex items-baseline justify-between gap-3 pb-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
              Issues
            </h1>
            {/* Only beside a list that loaded. A number next to a failure
                panel reads as real data — it was the previous filter's. */}
            {view === "list" && !initialLoad && !error && (
              <span className="text-[13px] tabular-nums text-zinc-600 dark:text-zinc-400">
                {total.toLocaleString()}
                {status !== "all" && ` ${statusLabel(status).toLowerCase()}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {reposError && (
              <FailureNote
                what="the repo list"
                message={reposError}
                onRetry={() => setReposToken((t) => t + 1)}
              />
            )}
            <div role="group" aria-label="View" className="flex items-center">
              {VIEW_VALUES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeFilter(() => setView(v))}
                  className={`rounded-md px-2 py-1 text-[13px] capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                    view === v
                      ? "bg-zinc-900/[0.06] text-zinc-900 dark:bg-white/[0.07] dark:text-zinc-100"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-300"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={reload}
              className="rounded-md px-2 py-1 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-300"
            >
              Refresh
            </button>
          </div>
        </header>

        <IssueToolbar
          status={status}
          onStatus={(v) => changeFilter(() => setStatus(v))}
          showStatus={view === "list"}
          counts={counts}
          search={search}
          onSearch={(v) => changeFilter(() => setSearch(v))}
          service={service}
          onService={(v) => changeFilter(() => setService(v))}
          services={services}
          hasPR={hasPR}
          onHasPR={(v) => changeFilter(() => setHasPR(v))}
          assignee={assignee}
          onAssignee={(v) => changeFilter(() => setAssignee(v))}
          assigneeOptions={isAdminUser ? assigneeOptions : undefined}
          sort={sort}
          onSort={(v) => changeFilter(() => setSort(v))}
          order={order}
          onOrder={(v) => changeFilter(() => setOrder(v))}
        />

        <RefetchBar active={view === "list" && refetching && !initialLoad} />
      </div>

      {view === "board" ? (
        filtersReady ? (
          <Board
            filters={baseFilters}
            sort={sort}
            order={order}
            reloadToken={reloadToken}
            filtered={filtered}
            ignoredCount={counts?.ignored}
            onShowIgnored={() =>
              changeFilter(() => {
                setView("list");
                setStatus("ignored");
              })
            }
          />
        ) : (
          <IssueListSkeleton />
        )
      ) : initialLoad ? (
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
          filtered={filtered}
          onClear={() =>
            changeFilter(() => {
              setService("");
              setSearch("");
              setHasPR("");
              setAssignee("");
            })
          }
          onAllStatuses={() => changeFilter(() => setStatus("all"))}
        />
      ) : (
        <>
          <IssueListHeader
            leading={
              canWrite ? (
                <PageSelectAll
                  checked={pageAllSelected}
                  indeterminate={pageSomeSelected && !pageAllSelected}
                  onChange={togglePage}
                />
              ) : undefined
            }
          />
          <IssueList
            issues={issues}
            showStatus={status === "all"}
            selected={selected}
            onToggle={toggle}
            dimmed={refetching}
            selectable={canWrite}
            focusedId={focusedId}
          />

          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                {offset + 1}–{Math.min(offset + issues.length, total)} of{" "}
                {total.toLocaleString()}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => goToOffset(offset - PAGE_SIZE)}
                  disabled={offset === 0}
                  className="rounded-md px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-white/[0.04]"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToOffset(offset + PAGE_SIZE)}
                  disabled={offset + issues.length >= total}
                  className="rounded-md px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-white/[0.04]"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          <p className="mt-3 hidden text-[11px] text-zinc-500 lg:block">
            <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>/</Kbd> search
            {canWrite && (
              <>
                {" "}· <Kbd>x</Kbd> select · <Kbd>e</Kbd> resolve · <Kbd>i</Kbd> ignore ·{" "}
                <Kbd>a</Kbd> assign to me
              </>
            )}
          </p>
        </>
      )}

      {/* Fixed to the viewport bottom, so the actions stay in reach after
          selecting rows a hundred lines down. */}
      {view === "list" && canWrite && (
        <BulkActionBar
          count={allMatching ? total : selected.size}
          noun="issue"
          onClear={clearSelection}
        >
          {allMatching ? (
            <span className="text-[12px] text-zinc-600 dark:text-zinc-400">all matching</span>
          ) : (
            pageAllSelected &&
            total > issues.length &&
            currentFilter && (
              <button
                onClick={() => setAllMatching(true)}
                className="text-[12px] text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
              >
                Select all {total.toLocaleString()} matching
              </button>
            )
          )}
          {/* "Reopen" too: there was no way to bulk-reopen issues resolved by
              mistake, only to move them further along. */}
          {(["unresolved", "in_progress", "resolved", "ignored"] as IssueStatus[])
            .filter((s) => s !== status)
            .map((s) => (
              <button
                key={s}
                onClick={() => void bulkUpdate(s)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {bulkBusy && <ButtonSpinner />}
                {STATUS_ACTIONS[s].verb}
              </button>
            ))}
          <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          {/* A select fires on change — including arrowing through a closed
              one on some platforms — so every choice goes through the confirm
              in bulkApply rather than applying on the spot. */}
          <select
            aria-label="Set priority on selected issues"
            value=""
            disabled={bulkBusy}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              void bulkApply(
                { priority: v === "none" ? null : (v as IssuePriority) },
                v === "none"
                  ? { verb: "Clear priority on", past: "cleared of priority" }
                  : { verb: "Set priority on", suffix: ` to ${v}`, past: `set to ${v} priority` },
              );
            }}
            className="rounded-md border border-zinc-300 bg-white px-1 py-1 text-base text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 sm:text-sm"
          >
            <option value="">Priority…</option>
            {(["critical", "high", "medium", "low"] as IssuePriority[]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value="none">No priority</option>
          </select>
          {isAdminUser && assignees ? (
            <select
              aria-label="Assign selected issues"
              value=""
              disabled={bulkBusy}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const u = assignees.find((x) => String(x.id) === v);
                const who = u?.name || u?.email || "user " + v;
                void bulkApply(
                  { assignee_user_id: v === "none" ? null : Number(v) },
                  v === "none"
                    ? { verb: "Unassign", past: "unassigned" }
                    : { verb: "Assign", suffix: ` to ${who}`, past: `assigned to ${who}` },
                );
              }}
              className="rounded-md border border-zinc-300 bg-white px-1 py-1 text-base text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 sm:text-sm"
            >
              <option value="">Assign…</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                  {u.id === user?.id ? " (you)" : ""}
                </option>
              ))}
              <option value="none">Unassign</option>
            </select>
          ) : (
            user && (
              <button
                onClick={() =>
                  void bulkApply(
                    { assignee_user_id: user.id },
                    { verb: "Assign", suffix: " to you", past: "assigned to you" },
                  )
                }
                disabled={bulkBusy}
                className="rounded-md px-2 py-1 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Assign to me
              </button>
            )
          )}
        </BulkActionBar>
      )}

      {confirming && (
        <Modal
          open
          onClose={bulkBusy ? () => {} : () => setConfirming(null)}
          title={`${confirming.matched.toLocaleString()} issue${confirming.matched === 1 ? "" : "s"} will be ${confirming.label}`}
          description="Every issue matching the current filters, across all pages. Each change is recorded on its issue's timeline, but there is no one-click undo for a change this size."
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming(null)}
                disabled={bulkBusy}
              >
                Cancel
              </Button>
              <Button type="button" loading={bulkBusy} onClick={runConfirmed}>
                Apply to {confirming.matched.toLocaleString()}
              </Button>
            </>
          }
        />
      )}
    </main>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 px-1 font-sans text-[10px] text-zinc-600 dark:border-white/10 dark:text-zinc-400">
      {children}
    </kbd>
  );
}

/**
 * Select-or-clear the current page. Sits in the list's checkbox column so it
 * reads as the column's header rather than as another filter.
 */
function PageSelectAll({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // indeterminate is a DOM property with no attribute, so React cannot set it.
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="-mx-0 flex w-fit cursor-pointer items-center gap-3 text-[12px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label="Select every issue on this page"
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-500"
      />
      {checked ? "Page selected" : "Select page"}
    </label>
  );
}

interface BoardColumnState {
  issues: Issue[];
  total: number;
  loadingMore: boolean;
  moreError: string | null;
}

/**
 * The board fetches EACH COLUMN BY ITS OWN STATUS, with the server's count.
 *
 * It used to take one fetch under the list's status tab (default "Open",
 * limit 500) and split it client-side, so on the default tab Active and
 * Resolved always read "0 · Nothing here" while hundreds existed, and a busy
 * zone's columns quietly stopped at 500. A false zero is DOWN-as-EMPTY by
 * another route. The status tabs are hidden in this view — the columns are the
 * statuses.
 */
function Board({
  filters,
  sort,
  order,
  reloadToken,
  filtered,
  ignoredCount,
  onShowIgnored,
}: {
  filters: ListIssuesParams;
  sort: SortKey;
  order: SortOrder;
  reloadToken: number;
  filtered: boolean;
  ignoredCount?: number;
  onShowIgnored: () => void;
}) {
  const zoned = useZoneHref();
  const [columns, setColumns] = useState<Record<string, BoardColumnState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refetching, setRefetching] = useState(false);
  const [retry, setRetry] = useState(0);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const query = useMemo(() => ({ ...filters, sort, order }), [filters, sort, order]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRefetching(true);
      const results = await Promise.all(
        BOARD_COLUMNS.map((status) =>
          reqListIssues({ ...query, status, limit: BOARD_PAGE, offset: 0 }),
        ),
      );
      if (cancelled) return;
      setRefetching(false);
      const failed = firstError(...results);
      if (failed) {
        setError(failed.error_message || "Could not load issues");
        return;
      }
      setError(null);
      const next: Record<string, BoardColumnState> = {};
      BOARD_COLUMNS.forEach((status, i) => {
        const r = results[i];
        const rows = r.success ? (r.data ?? []) : [];
        next[status] = {
          issues: rows,
          total: r.success ? (r.pagination?.count ?? rows.length) : 0,
          loadingMore: false,
          moreError: null,
        };
      });
      setColumns(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, reloadToken, retry]);

  const loadMore = async (status: IssueStatus) => {
    const col = columns?.[status];
    if (!col) return;
    setColumns((prev) =>
      prev ? { ...prev, [status]: { ...prev[status], loadingMore: true, moreError: null } } : prev,
    );
    const res = await reqListIssues({
      ...query,
      status,
      limit: BOARD_PAGE,
      offset: col.issues.length,
    });
    setColumns((prev) => {
      if (!prev) return prev;
      const c = prev[status];
      if (!res.success)
        return {
          ...prev,
          [status]: { ...c, loadingMore: false, moreError: res.error_message || "The request failed." },
        };
      const seen = new Set(c.issues.map((i) => i.id));
      return {
        ...prev,
        [status]: {
          issues: [...c.issues, ...(res.data ?? []).filter((i) => !seen.has(i.id))],
          total: res.pagination?.count ?? c.total,
          loadingMore: false,
          moreError: null,
        },
      };
    });
  };

  if (error)
    return <FailureState what="issues" message={error} onRetry={() => setRetry((t) => t + 1)} />;
  if (!columns) return <IssueListSkeleton />;

  return (
    <>
      {/* Phones see one column at a time; this row says the others exist and
          jumps to them. */}
      <div className="mb-2 flex gap-1 sm:hidden" role="group" aria-label="Jump to column">
        {BOARD_COLUMNS.map((column) => (
          <button
            key={column}
            type="button"
            onClick={() => {
              // Horizontal only: scrollIntoView also scrolled the page down,
              // tucking the column's heading under the sticky filters.
              const section = sectionRefs.current[column];
              const scroller = section?.parentElement;
              if (section && scroller)
                scroller.scrollTo({ left: section.offsetLeft - scroller.offsetLeft - 16, behavior: "smooth" });
            }}
            className="rounded-md border border-zinc-200 px-2 py-1 text-[12px] text-zinc-700 dark:border-white/[0.08] dark:text-zinc-300"
          >
            {STATUS_FILTERS.find((f) => f.value === column)?.label}{" "}
            <span className="tabular-nums text-zinc-500">{columns[column].total.toLocaleString()}</span>
          </button>
        ))}
      </div>
      {/* Horizontal, snapping scroll on narrow screens: three columns squeezed
          onto a phone are three unreadable columns. */}
      <div
        className={`-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 transition-opacity sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 ${
          refetching ? "opacity-50" : ""
        }`}
      >
        {BOARD_COLUMNS.map((column) => {
          const col = columns[column];
          const label =
            STATUS_FILTERS.find((f) => f.value === column)?.label ?? column;
          const dot =
            column === "unresolved"
              ? "bg-rose-500"
              : column === "in_progress"
                ? "bg-amber-500"
                : "bg-emerald-500";

          return (
            <section
              key={column}
              ref={(el) => {
                sectionRefs.current[column] = el;
              }}
              aria-label={`${label}: ${col.total} issues`}
              className="w-[85vw] shrink-0 snap-start sm:w-auto"
            >
              <h2 className="mb-1.5 flex items-center gap-2 px-0.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
                {label}
                <span className="tabular-nums font-normal text-zinc-600 dark:text-zinc-400">
                  {col.total.toLocaleString()}
                </span>
              </h2>
              <ul className="space-y-1">
                {col.issues.map((issue) => (
                  <li key={issue.id}>
                    <Link
                      href={zoned(`/errors/${issue.id}`)}
                      className="block rounded-md border border-zinc-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] px-2.5 py-2 transition-colors hover:border-zinc-300 dark:hover:border-white/[0.12] hover:bg-zinc-100 dark:hover:bg-white/[0.04]"
                    >
                      <p className="line-clamp-2 text-[13px] leading-5 text-zinc-900 dark:text-zinc-100">
                        {issueTitle(issue)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                        <span className="truncate text-indigo-600 dark:text-indigo-400">
                          {issue.service}
                        </span>
                        {(issue.priority === "high" || issue.priority === "critical") && (
                          <Tag tone={issue.priority === "critical" ? "rose" : "amber"}>
                            {issue.priority}
                          </Tag>
                        )}
                        {issue.regression_count > 0 && (
                          <Tag
                            tone="violet"
                            title={`Reopened ${issue.regression_count}× by a recurrence`}
                          >
                            regressed
                          </Tag>
                        )}
                        {issue.assignee && (
                          <span className="truncate">
                            {issue.assignee.name || issue.assignee.email}
                          </span>
                        )}
                        <span
                          className="ml-auto shrink-0 tabular-nums"
                          title={`${issue.occurrence_count.toLocaleString()} events · last seen ${new Date(issue.last_seen).toLocaleString()}`}
                        >
                          <span className="text-zinc-900 dark:text-zinc-200">
                            {formatCount(issue.occurrence_count)}
                          </span>{" "}
                          · {formatRelative(issue.last_seen)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
                {col.issues.length === 0 && (
                  <li className="px-1 py-5 text-center text-[12px] text-zinc-500">
                    {filtered ? "None match these filters" : "Nothing here"}
                  </li>
                )}
              </ul>
              {col.issues.length < col.total && (
                <div className="mt-2 flex items-center justify-between gap-2 px-0.5 text-[12px]">
                  <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                    {col.issues.length.toLocaleString()} of {col.total.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadMore(column)}
                    disabled={col.loadingMore}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
                  >
                    {col.loadingMore && <ButtonSpinner />}
                    Show more
                  </button>
                </div>
              )}
              {col.moreError && (
                <div className="mt-1">
                  <FailureNote
                    what="more issues"
                    message={col.moreError}
                    onRetry={() => void loadMore(column)}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
      {ignoredCount !== undefined && ignoredCount > 0 && (
        <p className="mt-3 text-[12px] text-zinc-600 dark:text-zinc-400">
          {ignoredCount.toLocaleString()} ignored issue{ignoredCount === 1 ? " is" : "s are"} not on the board.{" "}
          <button
            type="button"
            onClick={onShowIgnored}
            className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
          >
            Show ignored
          </button>
        </p>
      )}
    </>
  );
}

/** An empty screen is an invitation to act, so it says what to do next. */
function EmptyState({
  status,
  filtered,
  onClear,
  onAllStatuses,
}: {
  status: StatusFilter;
  filtered: boolean;
  onClear: () => void;
  onAllStatuses: () => void;
}) {
  const label = STATUS_FILTERS.find((f) => f.value === status)?.label ?? status;
  // The status is a filter too: "nothing matches" with a match sitting under
  // Resolved sent people away empty-handed. Say which status was searched.
  const scope = status === "all" ? "" : ` ${label}`;
  return (
    <div className="border-y border-zinc-200 dark:border-white/[0.06] py-16 text-center">
      <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
        {filtered
          ? `No${scope} issues match these filters.`
          : status === "unresolved"
            ? "Nothing open. Every error that has come in is triaged."
            : `No${scope} issues.`}
      </p>
      <div className="mt-1.5 flex justify-center gap-4">
        {status !== "all" && (filtered || status !== "unresolved") && (
          <button
            onClick={onAllStatuses}
            className="text-[13px] text-blue-700 transition-colors hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Search all statuses
          </button>
        )}
        {filtered && (
          <button
            onClick={onClear}
            className="text-[13px] text-blue-700 transition-colors hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

/** One bulk change: any of the fields POST /v1/issues/bulk can set. */
type BulkChange = Pick<BulkUpdateIssuesPayload, "status" | "priority" | "assignee_user_id">;
