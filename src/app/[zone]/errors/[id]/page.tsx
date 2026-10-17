"use client";

import { issueTitle } from "@/tools/issue.tools";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  reqAddIssueComment,
  reqDeleteIssueComment,
  reqEditIssueComment,
  reqGetIssue,
  reqGetIssueEvents,
  reqGetIssueHistory,
  reqGetIssueTimeline,
  reqLinkIssuePR,
  reqUnlinkIssuePR,
  reqUpdateIssue,
} from "@/services/api";
import {
  Event,
  Issue,
  IssueLink,
  IssuePriority,
  IssueStatus,
  IssueTimelineEntry,
  OccurrenceDay,
  TimelineEntryType,
} from "@/types";
import {
  IssuePriorityBadge,
  IssueStatusBadge,
  RegressionBadge,
  STATUS_LABELS,
} from "@/components/issue/IssueStatusBadge";
import { COMMENT_MAX_LENGTH, IssueTimeline } from "@/components/issue/IssueTimeline";
import { FailureNote, FailureState } from "@/components/FailureState";
import { IssueLinks } from "@/components/issue/IssueLinks";
import { OccurrenceSparkline } from "@/components/issue/OccurrenceSparkline";
import {
  CopyIconButton,
  EventDrawer,
  distinguishingKeys,
  eventPreview,
  formatEventTime,
  tagValue,
} from "@/components/issue/IssueEventDetail";
import {
  ButtonSpinner,
  DetailSkeleton,
  RefetchBar,
} from "@/components/issue/IssueChrome";
import { Segmented } from "@/components/ui/segmented";
import { useZoneHref } from "@/hooks/useZoneHref";
import { useScope } from "@/hooks/useScope";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/store/hooks";
import { useConfirm } from "@/components/ConfirmProvider";
import { reqListUsers } from "@/services/admin.service";
import { copyText } from "@/tools/clipboard.tools";
import type { AdminUser } from "@/types/auth.types";

const STATUSES: IssueStatus[] = [
  "unresolved",
  "in_progress",
  "resolved",
  "ignored",
];
const PRIORITIES: IssuePriority[] = ["low", "medium", "high", "critical"];

/**
 * The sparkline windows. 30 is what the detail read embeds (`issue.history`);
 * 7 is a slice of it; 90 is a separate history read, made only when picked.
 */
type HistoryWindow = "7" | "30" | "90";
const HISTORY_WINDOWS = [
  { value: "7", label: "7d", title: "Last 7 days" },
  { value: "30", label: "30d", title: "Last 30 days" },
  { value: "90", label: "90d", title: "Last 90 days" },
] as const;

/**
 * Recent events: the first page, the step "Load more" adds, and the API's
 * ceiling. `GET /v1/issues/{id}/events` takes a limit (clamped to 500) and no
 * offset, so "more" is a bigger newest-first page, and past 500 there is no
 * further page to ask for — the UI says so rather than offering a button that
 * cannot work.
 */
const EVENTS_PAGE = 20;
const EVENTS_STEP = 50;
const EVENTS_MAX = 500;

/**
 * The timeline is read oldest-first (the API's only order) in pages of the
 * API's max, and shown newest-first. `TIMELINE_SHOWN` entries render before
 * "Show older"; older pages are fetched only when the reveal reaches them.
 */
const TIMELINE_PAGE = 500;
const TIMELINE_SHOWN = 30;

type TimelineFilter = "all" | "comments" | "changes" | "prs";
const TIMELINE_FILTERS = [
  { value: "all", label: "All" },
  { value: "comments", label: "Comments" },
  { value: "changes", label: "Status" , title: "Status, priority, assignment and regressions" },
  { value: "prs", label: "PRs", title: "Pull request activity" },
] as const;
const FILTER_TYPES: Record<Exclude<TimelineFilter, "all">, (t: TimelineEntryType) => boolean> = {
  comments: (t) => t === "comment",
  changes: (t) => t !== "comment" && !t.startsWith("pr_"),
  prs: (t) => t.startsWith("pr_"),
};

/** Shared focus ring for this page's controls (finding: a 1px border tint is not one). */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950";
const SELECT_CLASS = `w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-base text-zinc-900 transition-colors hover:bg-zinc-50 focus:border-blue-500 sm:text-[13px] disabled:opacity-70 dark:border-white/[0.12] dark:bg-white/[0.02] dark:text-zinc-200 dark:hover:bg-white/[0.04] ${FOCUS_RING}`;

export default function IssueDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const zoned = useZoneHref();
  const { zone, project } = useScope();

  const [issue, setIssue] = useState<Issue | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refetching, setRefetching] = useState(false);
  // A missing issue and a failed read are different facts (AGENTS §5): one is
  // a wrong link, the other is an outage that a retry may fix.
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Timeline: entries[0] is at server offset `timelineStart`; the API counts
  // the total so the newest page can be asked for directly.
  const [timeline, setTimeline] = useState<IssueTimelineEntry[]>([]);
  const [timelineStart, setTimelineStart] = useState(0);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineShown, setTimelineShown] = useState(TIMELINE_SHOWN);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLimit, setEventsLimit] = useState(EVENTS_PAGE);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsFetching, setEventsFetching] = useState(false);
  const [drawerIndex, setDrawerIndex] = useState<number | null>(null);

  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>("30");
  const [history90, setHistory90] = useState<OccurrenceDay[] | null>(null);
  const [history90Error, setHistory90Error] = useState<string | null>(null);
  const [history90Token, setHistory90Token] = useState(0);

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const { canWrite, isAdmin } = useRole();
  const { user } = useAuth();
  const confirm = useConfirm();
  // The admin user list is admin-only on the API, so only admins get a picker;
  // everyone else who can write gets "Assign to me". It is read on first
  // focus/hover of the picker, not on every page view: most visits never
  // reassign, and the list is up to 500 accounts.
  const [assignees, setAssignees] = useState<AdminUser[] | null>(null);
  const [assigneesState, setAssigneesState] = useState<"idle" | "loading" | "failed">("idle");
  const [assigneesError, setAssigneesError] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => {
    setRefetching(true);
    setReloadToken((t) => t + 1);
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      // Fetched together rather than sequentially: none depends on another.
      const [issueRes, timelineRes] = await Promise.all([
        reqGetIssue(id),
        reqGetIssueTimeline(id, { limit: TIMELINE_PAGE }),
      ]);

      if (cancelled) return;

      if (!issueRes.success) {
        const missing = issueRes.status === 404 || issueRes.status === 400;
        setNotFound(missing);
        setError(missing ? null : issueRes.error_message || "The request failed.");
        setInitialLoad(false);
        setRefetching(false);
        return;
      }

      // The timeline arrives oldest-first. Past one page, the first page is the
      // OLDEST 500 — so ask again for the newest, which is what is shown.
      let entries = timelineRes.success ? (timelineRes.data ?? []) : [];
      let start = 0;
      let tlError = timelineRes.success ? null : timelineRes.error_message;
      const total = timelineRes.success ? (timelineRes.pagination?.count ?? entries.length) : 0;
      if (timelineRes.success && total > entries.length) {
        start = total - TIMELINE_PAGE;
        const newest = await reqGetIssueTimeline(id, { limit: TIMELINE_PAGE, offset: start });
        if (cancelled) return;
        if (newest.success) entries = newest.data ?? [];
        else {
          tlError = newest.error_message;
          start = 0;
        }
      }

      setNotFound(false);
      setError(null);
      setIssue(issueRes.data);
      // Timeline and events are supporting detail — if either fails the page is
      // still worth showing, so they degrade rather than taking the whole view
      // down. They degrade to a NOTED FAILURE, though, not to empty: the two
      // empty states here are "Nothing has happened on this issue yet" and "No
      // raw events left — events are kept for 30 days", and both are confident
      // explanations that a 500 has no right to borrow.
      setTimelineError(tlError);
      if (!tlError) {
        setTimeline(entries);
        setTimelineStart(start);
      }
      setInitialLoad(false);
      setRefetching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  // Events on their own effect, so "Load more" re-reads only them.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const res = await reqGetIssueEvents(id, eventsLimit);
      if (cancelled) return;
      setEventsError(res.success ? null : res.error_message);
      if (res.success) setEvents(res.data ?? []);
      setEventsLoading(false);
      setEventsFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, eventsLimit, reloadToken]);

  useEffect(() => {
    if (historyWindow !== "90" || history90 !== null || !id) return;
    let cancelled = false;
    void (async () => {
      const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const res = await reqGetIssueHistory(id, { from });
      if (cancelled) return;
      setHistory90Error(res.success ? null : res.error_message);
      if (res.success) setHistory90(res.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [historyWindow, history90, id, history90Token]);

  // The tab title names the issue; the layout's "Issue · zone" is the
  // placeholder until the read lands.
  useEffect(() => {
    if (!issue) return;
    document.title = `${issueTitle(issue)} · ${issue.service} · Monitor`;
  }, [issue]);

  const loadAssignees = async () => {
    if (!isAdmin || assigneesState === "loading" || assignees) return;
    setAssigneesState("loading");
    const res = await reqListUsers({ limit: 500 });
    if (!res.success) {
      setAssigneesState("failed");
      setAssigneesError(res.error_message);
      return;
    }
    setAssignees(res.data.filter((u) => u.active && u.role !== "pending"));
    setAssigneesState("idle");
  };

  /**
   * Applies a change locally before the request resolves, and rolls back if it
   * fails. A select that snaps back on error is honest; one that waits a round
   * trip before moving feels broken.
   */
  const update = async (
    patch: Parameters<typeof reqUpdateIssue>[1],
    optimistic: Partial<Issue>,
    field: string,
    label: string,
  ) => {
    const previous = issue;
    setSavingField(field);
    setIssue((prev) => (prev ? { ...prev, ...optimistic } : prev));

    const res = await reqUpdateIssue(id, patch);
    setSavingField(null);

    if (!res.success) {
      setIssue(previous);
      toast.error(res.error_message || `Could not ${label}`);
      return;
    }
    reload();
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    // No dedupe_key from the UI: a person clicking "Comment" twice means two
    // comments. The key exists for automated callers that may retry.
    const res = await reqAddIssueComment(id, comment.trim());
    setPosting(false);
    if (!res.success) {
      toast.error(res.error_message || "Could not add the comment");
      return;
    }
    setComment("");
    reload();
  };

  // Newest first: the latest activity belongs directly under the composer.
  const timelineNewestFirst = useMemo(() => {
    const filtered =
      timelineFilter === "all"
        ? timeline
        : timeline.filter((e) => FILTER_TYPES[timelineFilter](e.type));
    return [...filtered].reverse();
  }, [timeline, timelineFilter]);
  const visibleTimeline = timelineNewestFirst.slice(0, timelineShown);
  const moreLoaded = timelineNewestFirst.length > timelineShown;
  const moreOnServer = timelineStart > 0;

  const showOlder = async () => {
    if (moreLoaded) {
      setTimelineShown((n) => n + TIMELINE_SHOWN);
      return;
    }
    if (!moreOnServer) return;
    setLoadingOlder(true);
    const offset = Math.max(0, timelineStart - TIMELINE_PAGE);
    const res = await reqGetIssueTimeline(id, { limit: timelineStart - offset, offset });
    setLoadingOlder(false);
    if (!res.success) {
      toast.error(res.error_message || "Could not load older activity");
      return;
    }
    setTimeline((prev) => [...(res.data ?? []), ...prev]);
    setTimelineStart(offset);
    setTimelineShown((n) => n + TIMELINE_SHOWN);
  };

  const rowKeys = useMemo(() => distinguishingKeys(events), [events]);

  if (initialLoad) {
    return (
      <main className="mx-auto max-w-8xl px-4 py-4 pb-10 sm:px-6 lg:px-10">
        <DetailSkeleton />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Issue not found
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          There is no issue{" "}
          <code className="break-all rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">
            {id}
          </code>{" "}
          in the <span className="font-medium">{zone}</span> zone
          {project ? (
            <>
              {" "}
              (project <span className="font-medium">{project}</span>)
            </>
          ) : null}
          .
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Issues belong to the zone and project that recorded them. If this link
          came from somewhere else, pick its zone or project in the switcher at
          the top of the page.
        </p>
        <Link
          href={zoned("/errors")}
          className={`mt-5 inline-block rounded text-sm font-medium text-blue-600 hover:underline dark:text-blue-400 ${FOCUS_RING}`}
        >
          ← Back to issues
        </Link>
      </main>
    );
  }

  if (error || !issue) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="sr-only">Issue</h1>
        <FailureState
          what="this issue"
          message={error}
          onRetry={reload}
        />
        <Link
          href={zoned("/errors")}
          className={`mt-4 inline-block rounded text-sm font-medium text-blue-600 hover:underline dark:text-blue-400 ${FOCUS_RING}`}
        >
          ← Back to issues
        </Link>
      </main>
    );
  }

  const title = issueTitle(issue);
  const history =
    historyWindow === "90"
      ? (history90 ?? [])
      : (issue.history ?? []);
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <main className="mx-auto max-w-8xl px-4 py-4 pb-10 sm:px-6 lg:px-10">
      <Link
        href={zoned("/errors")}
        className={`rounded text-[13px] text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-300 ${FOCUS_RING}`}
      >
        ← Issues
      </Link>

      <header className="mt-2 border-b border-zinc-200 pb-3 dark:border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          <IssueStatusBadge status={issue.status} />
          {issue.priority && <IssuePriorityBadge priority={issue.priority} />}
          <RegressionBadge count={issue.regression_count} />
          <span className="text-xs text-indigo-600 dark:text-indigo-400">{issue.service}</span>
          {issue.repository && (
            <a
              href={`https://github.com/${issue.repository.owner}/${issue.repository.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 ${FOCUS_RING}`}
            >
              {issue.repository.owner}/{issue.repository.repo}
            </a>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void copyText(window.location.href, { label: "Link to issue" })}
              className={`rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-white/[0.1] dark:text-zinc-400 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={() => void copyText(issue.id, { label: "Issue ID" })}
              className={`rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-white/[0.1] dark:text-zinc-400 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
            >
              Copy ID
            </button>
          </div>
        </div>

        {/* Paired, like everything else: the unconditional dark value made the
            issue's own title invisible in the default theme. */}
        <div className="mt-1.5 flex items-start gap-1">
          <h1 className="min-w-0 break-words text-lg font-semibold leading-snug tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
          <span className="mt-0.5">
            <CopyIconButton label="Copy title" text={title} />
          </span>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
          {issue.name}
          {issue.path ? ` · ${issue.path}` : ""}
        </p>
      </header>

      <RefetchBar active={refetching} />

      {/* Content first in the DOM, sidebar second, so on desktop the reading
          and tab order follow the columns (WCAG 2.4.3). It used to be the other
          way round with lg:order-2, and Tab went down the right-hand sidebar
          before coming back to the left column. Below lg the sidebar is pulled
          up with order-first: in one column, status is the action you came to
          take, and the event list would otherwise bury it thousands of pixels
          down. */}
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <Section
            title={`Occurrences · last ${historyWindow} days`}
            action={
              <Segmented
                label="Occurrence window"
                options={HISTORY_WINDOWS}
                value={historyWindow}
                onChange={setHistoryWindow}
              />
            }
          >
            {historyWindow === "90" && history90Error ? (
              <FailureNote
                what="the 90-day history"
                message={history90Error}
                onRetry={() => {
                  setHistory90Error(null);
                  setHistory90Token((t) => t + 1);
                }}
              />
            ) : historyWindow === "90" && history90 === null ? (
              <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>
            ) : (
              <OccurrenceSparkline
                key={historyWindow}
                history={history}
                days={Number(historyWindow)}
                totalOccurrences={issue.occurrence_count}
              />
            )}
          </Section>

          <Section title="Recent events" count={events.length ? `${events.length}` : undefined}>
            {eventsError ? (
              <div className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center dark:border-white/[0.08]">
                <FailureNote
                  what="the recent events"
                  message={eventsError}
                  onRetry={reload}
                />
              </div>
            ) : eventsLoading ? (
              <p className="py-6 text-center text-sm text-zinc-500">Loading events…</p>
            ) : events.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-[13px] text-zinc-500 dark:border-white/[0.08]">
                No raw events left. Events are kept for 30 days — the occurrence
                history above outlives them.
              </p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {events.map((event, i) => (
                    <EventRow
                      key={`${event.timestamp}-${i}`}
                      event={event}
                      newer={events[i - 1]}
                      tagKeys={rowKeys}
                      onOpen={() => setDrawerIndex(i)}
                    />
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    Newest {events.length.toLocaleString()} of{" "}
                    {issue.occurrence_count.toLocaleString()} occurrences
                  </span>
                  {events.length >= eventsLimit && eventsLimit < EVENTS_MAX ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEventsFetching(true);
                        setEventsLimit((n) => Math.min(EVENTS_MAX, n + EVENTS_STEP));
                      }}
                      disabled={eventsFetching}
                      className={`rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-white/[0.1] dark:text-zinc-300 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
                    >
                      {eventsFetching ? "Loading…" : `Load ${Math.min(EVENTS_STEP, EVENTS_MAX - eventsLimit)} more`}
                    </button>
                  ) : events.length >= EVENTS_MAX ? (
                    <span>— the API returns at most the newest {EVENTS_MAX}.</span>
                  ) : null}
                </div>
              </>
            )}
          </Section>

          <Section title="Linked pull requests">
            <IssueLinks
              links={issue.links ?? []}
              repository={issue.repository}
              readOnly={!canWrite}
              onLink={async (url) => {
                const res = await reqLinkIssuePR(id, url);
                if (!res.success) throw new Error(res.error_message);
                toast.success("Linked");
                reload();
              }}
              onUnlink={async (link: IssueLink) => {
                const res = await reqUnlinkIssuePR(id, link.id);
                if (!res.success) {
                  toast.error(res.error_message || "Could not remove the link");
                  return;
                }
                reload();
              }}
            />
          </Section>

          <Section
            title="Activity"
            action={
              <Segmented
                label="Show activity"
                options={TIMELINE_FILTERS}
                value={timelineFilter}
                onChange={(v) => {
                  setTimelineFilter(v);
                  setTimelineShown(TIMELINE_SHOWN);
                }}
              />
            }
          >
            {canWrite && (
            <div className="mb-4">
              <label htmlFor="issue-comment" className="sr-only">Comment</label>
              <textarea
                id="issue-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter submits, matching every other comment box.
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void postComment();
                  }
                }}
                rows={3}
                maxLength={COMMENT_MAX_LENGTH}
                placeholder="Leave a note — what you found, what you tried, what is left."
                aria-describedby="issue-comment-hint"
                className={`w-full resize-y rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 sm:text-[13px] dark:border-white/[0.12] dark:bg-white/[0.02] dark:text-zinc-200 dark:placeholder:text-zinc-600 dark:focus:bg-white/[0.04] ${FOCUS_RING}`}
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={postComment}
                  disabled={posting || !comment.trim()}
                  className={`inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 ${FOCUS_RING}`}
                >
                  {posting && <ButtonSpinner />}
                  {posting ? "Posting" : "Comment"}
                </button>
                <span id="issue-comment-hint" className="text-xs text-zinc-500">
                  {comment.trim() && (
                    <span className="hidden sm:inline">
                      {isMac ? "⌘↵" : "Ctrl+Enter"} to post · plain text, line breaks kept
                    </span>
                  )}
                </span>
                {comment.length > COMMENT_MAX_LENGTH * 0.8 && (
                  <span
                    className={`ml-auto text-xs tabular-nums ${comment.length >= COMMENT_MAX_LENGTH ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}
                  >
                    {comment.length.toLocaleString()} / {COMMENT_MAX_LENGTH.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            )}

            {timelineError && (
              <div className="mb-2">
                <FailureNote
                  what="the activity timeline"
                  message={timelineError}
                  onRetry={reload}
                />
              </div>
            )}

            {!timelineError && timelineFilter !== "all" && visibleTimeline.length === 0 && timeline.length > 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No {timelineFilter === "comments" ? "comments" : timelineFilter === "prs" ? "pull request activity" : "status changes"}
                {moreOnServer ? " in the loaded activity." : " on this issue."}
              </p>
            ) : (
            <IssueTimeline
              entries={visibleTimeline}
              canModify={(entry) =>
                isAdmin ||
                (user != null && entry.actor_kind === "user" && entry.actor_user_id === user.id)
              }
              onEdit={async (entry, body) => {
                const res = await reqEditIssueComment(id, entry.id, body);
                if (!res.success) {
                  toast.error(res.error_message || "Could not save the edit");
                  return;
                }
                reload();
              }}
              onDelete={async (entry) => {
                const ok = await confirm({
                  title: "Delete this comment?",
                  description: "It is removed from the timeline for everyone. The deletion itself stays in the audit trail.",
                  confirmLabel: "Delete comment",
                  destructive: true,
                });
                if (!ok) return;
                const res = await reqDeleteIssueComment(id, entry.id);
                if (!res.success) {
                  toast.error(
                    res.error_message || "Could not delete the comment",
                  );
                  return;
                }
                reload();
              }}
            />
            )}
            {(moreLoaded || moreOnServer) && (
              <button
                type="button"
                onClick={() => void showOlder()}
                disabled={loadingOlder}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.1] dark:text-zinc-300 dark:hover:bg-white/[0.04] ${FOCUS_RING}`}
              >
                {loadingOlder && <ButtonSpinner />}
                Show older activity
              </button>
            )}
          </Section>
        </div>

        <aside aria-label="Triage and details" className="order-first space-y-4 lg:order-none">
          <Field label="Status" htmlFor="issue-status" busy={savingField === "status"}>
            <select
              id="issue-status"
              value={issue.status}
              onChange={(e) => {
                const next = e.target.value as IssueStatus;
                void update(
                  { status: next },
                  { status: next },
                  "status",
                  "change the status",
                );
              }}
              disabled={!canWrite}
              className={SELECT_CLASS}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority" htmlFor="issue-priority" busy={savingField === "priority"}>
            <select
              id="issue-priority"
              value={issue.priority ?? ""}
              onChange={(e) => {
                // "" is the "no priority" option, and clearing needs an explicit
                // null — an omitted key means "leave it alone".
                const next = e.target.value
                  ? (e.target.value as IssuePriority)
                  : null;
                void update(
                  { priority: next },
                  { priority: next ?? undefined },
                  "priority",
                  "change the priority",
                );
              }}
              disabled={!canWrite}
              className={`${SELECT_CLASS} capitalize`}
            >
              <option value="">None</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assignee" htmlFor="issue-assignee" busy={savingField === "assignee" || assigneesState === "loading"}>
            {isAdmin ? (
              <>
                <select
                  id="issue-assignee"
                  value={issue.assignee_user_id ?? ""}
                  onFocus={() => void loadAssignees()}
                  onPointerEnter={() => void loadAssignees()}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    const picked = assignees?.find((u) => u.id === id);
                    void update(
                      { assignee_user_id: id },
                      {
                        assignee_user_id: id ?? undefined,
                        assignee: picked ? { id: picked.id, email: picked.email, name: picked.name } as Issue["assignee"] : undefined,
                      },
                      "assignee",
                      id ? "assign the issue" : "unassign",
                    );
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">Unassigned</option>
                  {/* The current assignee stays listed even before the list
                      loads, or if their account was since disabled, so the
                      control never misreports. */}
                  {issue.assignee_user_id != null && !assignees?.some((u) => u.id === issue.assignee_user_id) && (
                    <option value={issue.assignee_user_id}>
                      {issue.assignee?.name || issue.assignee?.email || `User ${issue.assignee_user_id}`}
                    </option>
                  )}
                  {assignees?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email}
                      {u.id === user?.id ? " (you)" : ""}
                    </option>
                  ))}
                  {!assignees && assigneesState === "loading" && (
                    <option disabled value="__loading">Loading people…</option>
                  )}
                </select>
                {assigneesState === "failed" && (
                  <div className="mt-1.5">
                    <FailureNote
                      what="the people list"
                      message={assigneesError}
                      onRetry={() => void loadAssignees()}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                  {issue.assignee
                    ? issue.assignee.name || issue.assignee.email
                    : "Unassigned"}
                </p>
                {canWrite && user && issue.assignee_user_id !== user.id && (
                  <button
                    onClick={() =>
                      void update(
                        { assignee_user_id: user.id },
                        { assignee_user_id: user.id, assignee: { id: user.id, email: user.email, name: user.name } as Issue["assignee"] },
                        "assignee",
                        "assign the issue",
                      )
                    }
                    className={`shrink-0 rounded text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 ${FOCUS_RING}`}
                  >
                    Assign to me
                  </button>
                )}
                {canWrite && issue.assignee_user_id != null && (
                  <button
                    onClick={() =>
                      void update(
                        { assignee_user_id: null },
                        { assignee_user_id: undefined, assignee: undefined },
                        "assignee",
                        "unassign",
                      )
                    }
                    className={`shrink-0 rounded text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 ${FOCUS_RING}`}
                  >
                    Unassign
                  </button>
                )}
              </div>
            )}
          </Field>

          <dl className="space-y-2 rounded-md border border-zinc-200 p-2.5 dark:border-white/[0.06]">
            <Stat
              label="Occurrences (all time)"
              value={issue.occurrence_count.toLocaleString()}
            />
            <Stat label="First seen" iso={issue.first_seen} />
            <Stat label="Last seen" iso={issue.last_seen} />
            {issue.resolved_at && <Stat label="Resolved" iso={issue.resolved_at} />}
            {issue.regression_count > 0 && (
              <Stat
                label="Regressions"
                value={issue.regression_count.toLocaleString()}
              />
            )}
            {issue.regressed_at && <Stat label="Last regressed" iso={issue.regressed_at} />}
          </dl>

          <SeenIn events={events} />

          <div className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-zinc-600 dark:text-zinc-400">Fingerprint</p>
              <CopyIconButton label="Copy fingerprint" text={issue.fingerprint} />
            </div>
            <code className="mt-1 block break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
              {issue.fingerprint}
            </code>
          </div>
        </aside>
      </div>

      <EventDrawer
        events={events}
        index={drawerIndex}
        onIndexChange={setDrawerIndex}
        onClose={() => setDrawerIndex(null)}
        canLoadMore={events.length >= eventsLimit && eventsLimit < EVENTS_MAX}
      />
    </main>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          {title}
          {count ? ` · ${count}` : ""}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  busy,
  children,
}: {
  label: string;
  htmlFor: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
      >
        {label}
        {busy && <ButtonSpinner className="text-zinc-400" />}
      </label>
      {children}
    </div>
  );
}

/** A value, or a timestamp shown with its year and the full instant on hover. */
function Stat({ label, value, iso }: { label: string; value?: string; iso?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="text-right text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-300">
        {iso ? (
          <time dateTime={iso} title={formatFull(iso)}>
            {formatDate(iso)}
          </time>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * Where the loaded occurrences came from — environments, releases, hosts,
 * affected users. Derived from the recent events on screen, and labelled as
 * such: it is a sample of the newest, not a census of the issue.
 */
const SEEN_IN_KEYS: [string, string][] = [
  ["env", "Environment"],
  ["data.release", "Release"],
  ["data.version", "Version"],
  ["data.container_name", "Container"],
  ["data.host", "Host"],
  ["data.hostname", "Host"],
  ["data.zone", "Zone"],
];

function SeenIn({ events }: { events: Event[] }) {
  if (events.length === 0) return null;
  const rows: { label: string; values: [string, number][]; distinct: number }[] = [];
  const seenLabels = new Set<string>();
  for (const [key, label] of SEEN_IN_KEYS) {
    if (seenLabels.has(label)) continue;
    const counts = new Map<string, number>();
    for (const e of events) {
      const v = tagValue(e, key);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    seenLabels.add(label);
    const values = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    rows.push({ label, values: values.slice(0, 3), distinct: values.length });
  }
  const users = new Set(events.map((e) => e.user_id).filter(Boolean));

  if (rows.length === 0 && users.size === 0) return null;

  return (
    <div className="rounded-md border border-zinc-200 p-2.5 dark:border-white/[0.06]">
      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Seen in</p>
      <p className="mb-2 text-xs text-zinc-500">From the newest {events.length} events</p>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs text-zinc-600 dark:text-zinc-400">{row.label}</dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {row.values.map(([v, n]) => (
                <span
                  key={v}
                  className="max-w-full truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300"
                  title={`${v} — ${n} of ${events.length}`}
                >
                  {v} <span className="text-zinc-500">{n}</span>
                </span>
              ))}
              {row.distinct > 3 && (
                <span className="text-xs text-zinc-500">+{row.distinct - 3} more</span>
              )}
            </dd>
          </div>
        ))}
        {users.size > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-zinc-600 dark:text-zinc-400">Affected users</dt>
            <dd className="text-xs font-medium tabular-nums text-zinc-800 dark:text-zinc-300">{users.size}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * One occurrence. Two events a millisecond apart with the same message are
 * NOT duplicates — typically one per container — so each row shows the
 * millisecond, the gap to the newer row when it is under a second, and the
 * tag values that differ across the list (`distinguishingKeys`).
 */
function EventRow({
  event,
  newer,
  tagKeys,
  onOpen,
}: {
  event: Event;
  newer?: Event;
  tagKeys: string[];
  onOpen: () => void;
}) {
  const preview = eventPreview(event);
  const gap = newer
    ? new Date(newer.timestamp).getTime() - new Date(event.timestamp).getTime()
    : null;
  const tags = tagKeys
    .map((k) => [k.replace(/^data\./, ""), tagValue(event, k)] as const)
    .filter(([, v]) => v);

  return (
    <li className="overflow-hidden rounded-md border border-zinc-200 dark:border-white/[0.06]">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03] ${FOCUS_RING} focus-visible:ring-inset`}
      >
        <time
          dateTime={event.timestamp}
          className="shrink-0 font-mono text-zinc-600 dark:text-zinc-400"
        >
          {formatEventTime(event.timestamp)}
        </time>
        {gap !== null && gap >= 0 && gap < 1000 && (
          <span
            className="shrink-0 rounded bg-zinc-100 px-1 font-mono text-zinc-500 dark:bg-white/[0.06]"
            title="Time before the newer event above — a separate occurrence, not a duplicate"
          >
            −{gap}ms
          </span>
        )}
        {preview && (
          <span className="min-w-0 flex-1 basis-40 truncate text-zinc-500 dark:text-zinc-400">
            {preview}
          </span>
        )}
        {tags.map(([k, v]) => (
          <span
            key={k}
            className="max-w-[14rem] shrink-0 truncate rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
            // The value alone: the key is the same on every row, and with it
            // the part that differs was the part truncated away.
            title={`${k}: ${v}`}
          >
            <span className="sr-only">{k}: </span>
            {v}
          </span>
        ))}
        {event.level && (
          <span className="ml-auto shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
            {event.level}
          </span>
        )}
      </button>
    </li>
  );
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFull(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  });
}
