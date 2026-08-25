"use client";

import { useState } from "react";
import { ActorKind, IssueTimelineEntry, TimelineEntryType } from "@/types";

/**
 * The activity feed: comments, status transitions, regressions, assignments and
 * pull-request events interleaved chronologically.
 *
 * Comments render as cards because they are authored prose someone should read.
 * Everything else renders as a single dense line, because a status change is a
 * fact you scan past on the way to the next comment — giving both the same
 * weight buries the writing under the bookkeeping.
 */
export function IssueTimeline({
  entries,
  onEdit,
  onDelete,
}: {
  entries: IssueTimelineEntry[];
  onEdit?: (entry: IssueTimelineEntry, body: string) => Promise<void>;
  onDelete?: (entry: IssueTimelineEntry) => Promise<void>;
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
            onEdit={onEdit}
            onDelete={onDelete}
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
          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
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
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(entry)}
                className="text-xs text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
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
            className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        // whitespace-pre-wrap, not a markdown renderer: agent notes are
        // frequently pasted log lines and stack traces, where preserved
        // line breaks matter more than formatting.
        <p className="whitespace-pre-wrap px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-200">
          {entry.body}
        </p>
      )}
    </li>
  );
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
        {entry.body ?? entry.type.replace(/_/g, " ")}{" "}
        <span className="whitespace-nowrap text-xs text-zinc-400 dark:text-zinc-500">
          {formatWhen(entry.created_at)}
        </span>
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
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style}`}
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
