"use client";

import { useState } from "react";
import { ActorKind, IssueStatus, IssueTimelineEntry, TimelineEntryType } from "@/types";
import { IssueStatusBadge, STATUS_LABELS } from "@/components/issue/IssueStatusBadge";

/** Focus ring shared by the timeline's text buttons. */
const FOCUS = "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60";

/**
 * Client-side cap on a comment. The `body` column is MariaDB TEXT — 65,535
 * BYTES, so as few as 16,383 utf8mb4 characters — and monitor-core does not
 * check the length itself. 10,000 is far past any note a person writes and
 * safely under the column whatever the script.
 */
export const COMMENT_MAX_LENGTH = 10_000;

/** A comment taller than this many lines collapses behind "Show more". */
const COLLAPSE_LINES = 12;
const COLLAPSE_CHARS = 1200;

/**
 * The activity feed: comments, status transitions, regressions, assignments and
 * pull-request events interleaved chronologically.
 *
 * Comments render as cards because they are authored prose someone should read.
 * Everything else renders as a single dense line, because a status change is a
 * fact you scan past on the way to the next comment — giving both the same
 * weight buries the writing under the bookkeeping.
 *
 * Renders `entries` in the order given; the page passes them newest-first so
 * the latest activity sits directly under the composer.
 */
export function IssueTimeline({
  entries,
  onEdit,
  onDelete,
  canModify,
}: {
  entries: IssueTimelineEntry[];
  onEdit?: (entry: IssueTimelineEntry, body: string) => Promise<void>;
  onDelete?: (entry: IssueTimelineEntry) => Promise<void>;
  /**
   * Whether the viewer may change THIS comment. monitor-core allows the author
   * and admins only; offering Edit on someone else's note is a button that can
   * only fail.
   */
  canModify?: (entry: IssueTimelineEntry) => boolean;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Nothing has happened on this issue yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) =>
        entry.type === "comment" ? (
          <CommentCard
            key={entry.id}
            entry={entry}
            onEdit={!canModify || canModify(entry) ? onEdit : undefined}
            onDelete={!canModify || canModify(entry) ? onDelete : undefined}
          />
        ) : (
          <EventLine key={entry.id} entry={entry} />
        ),
      )}
    </ol>
  );
}

function CommentCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: IssueTimelineEntry;
  onEdit?: (entry: IssueTimelineEntry, body: string) => Promise<void>;
  onDelete?: (entry: IssueTimelineEntry) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.body ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!onEdit || !draft.trim()) return;
    setBusy(true);
    try {
      await onEdit(entry, draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2">
          <ActorChip kind={entry.actor_kind} label={entry.actor_label} />
          <span
            className="truncate text-xs text-zinc-500 dark:text-zinc-400"
            title={new Date(entry.created_at).toLocaleString()}
          >
            commented {formatWhen(entry.created_at)}
            {entry.edited_at ? " · edited" : ""}
          </span>
        </div>
        {(onEdit || onDelete) && !editing && (
          <div className="flex shrink-0 gap-2">
            {onEdit && (
              <button
                onClick={() => {
                  setDraft(entry.body ?? "");
                  setEditing(true);
                }}
                className={`${FOCUS} text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100`}
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(entry)}
                className={`${FOCUS} text-xs text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400`}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            aria-label="Edit comment"
            maxLength={COMMENT_MAX_LENGTH}
            className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 sm:text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 disabled:opacity-50 dark:ring-offset-zinc-900"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <CommentBody body={entry.body ?? ""} />
      )}
    </li>
  );
}

/**
 * whitespace-pre-wrap, not a markdown renderer: agent notes are frequently
 * pasted log lines and stack traces, where preserved line breaks matter more
 * than formatting. A long paste collapses so one log dump does not push the
 * rest of the thread off the screen.
 */
function CommentBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.split("\n").length > COLLAPSE_LINES || body.length > COLLAPSE_CHARS;
  return (
    <div className="px-3 py-2.5">
      <p
        className={`whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200 ${
          long && !expanded ? "max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]" : ""
        }`}
      >
        {body}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={`${FOCUS} mt-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400`}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * The server writes status changes as "Status changed from unresolved to
 * in_progress." — backend enums, where every other surface says "Open" and
 * "In Progress". The entry also carries `metadata.from`/`to`, so render those
 * as the same badges the header uses.
 */
function isStatus(v: unknown): v is IssueStatus {
  return typeof v === "string" && v in STATUS_LABELS;
}

function EventBody({ entry }: { entry: IssueTimelineEntry }) {
  const from = entry.metadata?.from;
  const to = entry.metadata?.to;
  if (entry.type === "status_changed" && isStatus(from) && isStatus(to)) {
    return (
      <>
        changed the status from <IssueStatusBadge status={from} /> to{" "}
        <IssueStatusBadge status={to} />
      </>
    );
  }
  const body = entry.body ?? entry.type.replace(/_/g, " ");
  // Older entries without metadata: translate the enums in the sentence.
  return <>{body.replace(/\b(unresolved|in_progress|resolved|ignored)\b/g, (m) => STATUS_LABELS[m as IssueStatus])}</>;
}

function EventLine({ entry }: { entry: IssueTimelineEntry }) {
  return (
    <li className="flex items-start gap-2 px-1 text-sm">
      <span className="mt-0.5 w-4 shrink-0 text-center" aria-hidden>
        {ICONS[entry.type] ?? "•"}
      </span>
      <span className="min-w-0 text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {entry.actor_label}
        </span>{" "}
        <EventBody entry={entry} />{" "}
        <time
          dateTime={entry.created_at}
          title={new Date(entry.created_at).toLocaleString()}
          className="whitespace-nowrap text-xs text-zinc-500"
        >
          {formatWhen(entry.created_at)}
        </time>
      </span>
    </li>
  );
}

const ICONS: Partial<Record<TimelineEntryType, string>> = {
  status_changed: "◐",
  regressed: "↩",
  assigned: "◉",
  unassigned: "○",
  priority_changed: "▲",
  title_changed: "✎",
  pr_linked: "🔗",
  pr_unlinked: "⊘",
  pr_merged: "✔",
  pr_closed: "✕",
  pr_reopened: "↻",
};

/**
 * Distinguishes who acted. An agent's note and a colleague's note carry very
 * different weight when you are deciding whether to trust a conclusion, and the
 * label alone ("monitor-mcp") does not make that obvious at a glance.
 */
function ActorChip({ kind, label }: { kind: ActorKind; label: string }) {
  const style =
    kind === "api_key"
      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
      : kind === "system"
        ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {label}
      </span>
      {kind !== "user" && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${style}`}
        >
          {kind === "api_key" ? "agent" : "system"}
        </span>
      )}
    </span>
  );
}

function formatWhen(iso: string) {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
