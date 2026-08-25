"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
import Spinner from "@/components/Spinner";

const STATUSES: IssueStatus[] = [
  "unresolved",
  "in_progress",
  "resolved",
  "ignored",
];
const PRIORITIES: IssuePriority[] = ["low", "medium", "high", "critical"];

export default function IssueDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");

  const [issue, setIssue] = useState<Issue | null>(null);
  const [timeline, setTimeline] = useState<IssueTimelineEntry[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  // Bumped after any mutation to refetch without changing the route.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((t) => t + 1);

  // Every setState happens after the first await, so the effect body itself
  // performs no synchronous state updates.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      // Fetched together rather than sequentially: three round trips in
      // series is a visibly slower page for no benefit, and none of them
      // depends on another's result.
      const [issueRes, timelineRes, eventsRes] = await Promise.all([
        reqGetIssue(id),
        reqGetIssueTimeline(id, { limit: 200 }),
        reqGetIssueEvents(id, 20),
      ]);

      if (cancelled) return;

      if (!issueRes.success) {
        setError(issueRes.error_message || "Failed to load issue");
        setLoading(false);
        return;
      }

      setError(null);
      setIssue(issueRes.data);
      // The timeline and events are supporting detail — if either fails the
      // page is still worth showing, so they degrade to empty rather than
      // taking the whole view down with them.
      if (timelineRes.success) setTimeline(timelineRes.data ?? []);
      if (eventsRes.success) setEvents(eventsRes.data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  const update = async (
    patch: Parameters<typeof reqUpdateIssue>[1],
    label: string,
  ) => {
    const res = await reqUpdateIssue(id, patch);
    if (!res.success) {
      toast.error(res.error_message || `Failed to ${label}`);
      return;
    }
    toast.success(label);
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
      toast.error(res.error_message || "Failed to add comment");
      return;
    }
    setComment("");
    reload();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">
          {error ?? "Issue not found"}
        </p>
        <Link
          href="/errors"
          className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to issues
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href="/errors"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
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

        <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {issue.title || issue.name}
        </h1>
        <p className="mt-1 break-words font-mono text-sm text-zinc-600 dark:text-zinc-400">
          {issue.message}
        </p>
        {issue.path && (
          <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-500">
            {issue.path}
          </p>
        )}
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-6">
          <Section title="Occurrences">
            <OccurrenceSparkline history={issue.history ?? []} />
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat
                label="Total"
                value={issue.occurrence_count.toLocaleString()}
              />
              <Stat label="First seen" value={formatDate(issue.first_seen)} />
              <Stat label="Last seen" value={formatDate(issue.last_seen)} />
              <Stat
                label="Regressions"
                value={issue.regression_count.toLocaleString()}
              />
            </dl>
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
                  toast.error(res.error_message || "Failed to remove link");
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
                rows={3}
                placeholder="Leave a note — what you found, what you tried, what is left."
                className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                onClick={postComment}
                disabled={posting || !comment.trim()}
                className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {posting ? "Posting…" : "Comment"}
              </button>
            </div>

            <IssueTimeline
              entries={timeline}
              onEdit={async (entry, body) => {
                const res = await reqEditIssueComment(id, entry.id, body);
                if (!res.success) {
                  toast.error(res.error_message || "Failed to edit");
                  return;
                }
                reload();
              }}
              onDelete={async (entry) => {
                const res = await reqDeleteIssueComment(id, entry.id);
                if (!res.success) {
                  toast.error(res.error_message || "Failed to delete");
                  return;
                }
                reload();
              }}
            />
          </Section>

          <Section title={`Recent events (${events.length})`}>
            {events.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No raw events available. Events are retained for 30 days — the
                occurrence history above outlives them.
              </p>
            ) : (
              <ul className="space-y-2">
                {events.map((event, i) => (
                  <EventRow key={`${event.timestamp}-${i}`} event={event} />
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="space-y-5">
          <Field label="Status">
            <select
              value={issue.status}
              onChange={(e) =>
                update(
                  { status: e.target.value as IssueStatus },
                  "Status updated",
                )
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority">
            <select
              value={issue.priority ?? ""}
              onChange={(e) =>
                update(
                  // "" is the "no priority" option, and clearing needs an
                  // explicit null — an omitted key means "leave it alone".
                  {
                    priority: e.target.value
                      ? (e.target.value as IssuePriority)
                      : null,
                  },
                  "Priority updated",
                )
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">None</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assignee">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {issue.assignee
                ? issue.assignee.name || issue.assignee.email
                : "Unassigned"}
            </p>
            {issue.assignee_user_id != null && (
              <button
                onClick={() => update({ assignee_user_id: null }, "Unassigned")}
                className="mt-1 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Unassign
              </button>
            )}
          </Field>

          <Field label="Fingerprint">
            <code className="block break-all text-[11px] text-zinc-500 dark:text-zinc-500">
              {issue.fingerprint}
            </code>
          </Field>

          <button
            onClick={() => router.push("/errors")}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Back to issues
          </button>
        </aside>
      </div>
    </div>
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
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="font-medium text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
        <span className="font-mono text-zinc-600 dark:text-zinc-400">
          {new Date(event.timestamp).toLocaleString()}
        </span>
        {event.level && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
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
  return new Date(iso).toLocaleString();
}
