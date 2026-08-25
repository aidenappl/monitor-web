"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  reqAddIssueComment,
  reqDeleteIssueComment,
  reqEditIssueComment,
  reqGetIssue,
  reqGetIssueEvents,
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
} from "@/types";
import {
  IssuePriorityBadge,
  IssueStatusBadge,
  RegressionBadge,
  STATUS_LABELS,
} from "@/components/issue/IssueStatusBadge";
import { IssueTimeline } from "@/components/issue/IssueTimeline";
import { IssueLinks } from "@/components/issue/IssueLinks";
import { OccurrenceSparkline } from "@/components/issue/OccurrenceSparkline";
import {
  ButtonSpinner,
  DetailSkeleton,
  RefetchBar,
} from "@/components/issue/IssueChrome";

const STATUSES: IssueStatus[] = [
  "unresolved",
  "in_progress",
  "resolved",
  "ignored",
];
const PRIORITIES: IssuePriority[] = ["low", "medium", "high", "critical"];

/** The sparkline window on the detail view. */
const HISTORY_DAYS = 30;

export default function IssueDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? "");

  const [issue, setIssue] = useState<Issue | null>(null);
  const [timeline, setTimeline] = useState<IssueTimelineEntry[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => {
    setRefetching(true);
    setReloadToken((t) => t + 1);
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      // Fetched together rather than sequentially: three round trips in series
      // is a visibly slower page for no benefit, and none depends on another.
      const [issueRes, timelineRes, eventsRes] = await Promise.all([
        reqGetIssue(id),
        reqGetIssueTimeline(id, { limit: 200 }),
        reqGetIssueEvents(id, 20),
      ]);

      if (cancelled) return;

      if (!issueRes.success) {
        setError(issueRes.error_message || "Failed to load issue");
        setInitialLoad(false);
        setRefetching(false);
        return;
      }

      setError(null);
      setIssue(issueRes.data);
      // Timeline and events are supporting detail — if either fails the page is
      // still worth showing, so they degrade to empty rather than taking the
      // whole view down.
      if (timelineRes.success) setTimeline(timelineRes.data ?? []);
      if (eventsRes.success) setEvents(eventsRes.data ?? []);
      setInitialLoad(false);
      setRefetching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

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

  if (initialLoad) {
    return (
      <main className="mx-auto max-w-8xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <DetailSkeleton />
      </main>
    );
  }

  if (error || !issue) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">
          {error ?? "Issue not found"}
        </p>
        <Link
          href="/errors"
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Back to issues
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-8xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <Link
        href="/errors"
        className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← Issues
      </Link>

      <header className="mt-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <IssueStatusBadge status={issue.status} />
          {issue.priority && <IssuePriorityBadge priority={issue.priority} />}
          <RegressionBadge count={issue.regression_count} />
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {issue.service}
          </span>
          {issue.repository && (
            <a
              href={`https://github.com/${issue.repository.owner}/${issue.repository.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              {issue.repository.owner}/{issue.repository.repo}
            </a>
          )}
        </div>

        <h1 className="mt-2 break-words text-lg font-semibold leading-snug text-zinc-900 sm:text-xl dark:text-zinc-100">
          {issue.title || issue.message || issue.name}
        </h1>
        <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {issue.name}
          {issue.path ? ` · ${issue.path}` : ""}
        </p>
      </header>

      <RefetchBar active={refetching} />

      {/* The sidebar comes FIRST in the DOM so it stacks above the content on a
          phone: status is the action you came to take, and it should not sit
          below a timeline you have to scroll past. On desktop it is ordered back
          to the right. */}
      <div className="mt-4 grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4 lg:order-2">
          <Field label="Status" busy={savingField === "status"}>
            <select
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
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority" busy={savingField === "priority"}>
            <select
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
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">None</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assignee" busy={savingField === "assignee"}>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                {issue.assignee
                  ? issue.assignee.name || issue.assignee.email
                  : "Unassigned"}
              </p>
              {issue.assignee_user_id != null && (
                <button
                  onClick={() =>
                    void update(
                      { assignee_user_id: null },
                      { assignee_user_id: undefined, assignee: undefined },
                      "assignee",
                      "unassign",
                    )
                  }
                  className="shrink-0 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Unassign
                </button>
              )}
            </div>
          </Field>

          <dl className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <Stat
              label="Occurrences"
              value={issue.occurrence_count.toLocaleString()}
            />
            <Stat label="First seen" value={formatDate(issue.first_seen)} />
            <Stat label="Last seen" value={formatDate(issue.last_seen)} />
            {issue.regression_count > 0 && (
              <Stat
                label="Regressions"
                value={issue.regression_count.toLocaleString()}
              />
            )}
          </dl>

          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
              Fingerprint
            </summary>
            <code className="mt-1 block break-all text-[11px] text-zinc-500 dark:text-zinc-500">
              {issue.fingerprint}
            </code>
          </details>
        </aside>

        <div className="min-w-0 space-y-6 lg:order-1">
          <Section title={`Occurrences · last ${HISTORY_DAYS} days`}>
            <OccurrenceSparkline
              history={issue.history ?? []}
              days={HISTORY_DAYS}
              totalOccurrences={issue.occurrence_count}
            />
          </Section>

          <Section title="Linked pull requests">
            <IssueLinks
              links={issue.links ?? []}
              repository={issue.repository}
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

          <Section title="Activity">
            <div className="mb-4">
              <textarea
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
                placeholder="Leave a note — what you found, what you tried, what is left."
                className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={postComment}
                  disabled={posting || !comment.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {posting && <ButtonSpinner />}
                  {posting ? "Posting" : "Comment"}
                </button>
                {comment.trim() && (
                  <span className="hidden text-xs text-zinc-400 sm:inline dark:text-zinc-500">
                    ⌘↵ to post
                  </span>
                )}
              </div>
            </div>

            <IssueTimeline
              entries={timeline}
              onEdit={async (entry, body) => {
                const res = await reqEditIssueComment(id, entry.id, body);
                if (!res.success) {
                  toast.error(res.error_message || "Could not save the edit");
                  return;
                }
                reload();
              }}
              onDelete={async (entry) => {
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
          </Section>

          <Section
            title={`Recent events${events.length ? ` · ${events.length}` : ""}`}
          >
            {events.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                No raw events left. Events are kept for 30 days — the occurrence
                history above outlives them.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((event, i) => (
                  <EventRow key={`${event.timestamp}-${i}`} event={event} />
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  busy,
  children,
}: {
  label: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
        {busy && <ButtonSpinner className="text-zinc-400" />}
      </p>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  // The first useful string in the payload, so a collapsed row says something
  // more than its timestamp.
  const preview =
    (typeof event.data?.error === "string" && event.data.error) ||
    (typeof event.data?.message === "string" && event.data.message) ||
    (typeof event.data?.error_message === "string" &&
      event.data.error_message) ||
    "";

  return (
    <li className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <span className="w-2 shrink-0 text-zinc-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="shrink-0 font-mono text-zinc-600 dark:text-zinc-400">
          {new Date(event.timestamp).toLocaleString()}
        </span>
        {preview && (
          <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-500">
            {preview}
          </span>
        )}
        {event.level && (
          <span className="ml-auto shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
            {event.level}
          </span>
        )}
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-zinc-100 px-2.5 py-2 text-[11px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          {JSON.stringify(event.data ?? {}, null, 2)}
        </pre>
      )}
    </li>
  );
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
