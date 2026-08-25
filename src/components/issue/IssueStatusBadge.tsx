import { IssuePriority, IssueStatus } from "@/types";

/**
 * Status colours, kept in one place because they appear on the list rows, the
 * board columns, the detail header and the filter tabs — four surfaces that must
 * agree or the same issue reads as two different things.
 *
 * `unresolved` is red because it is untriaged, not because it is worse than
 * `in_progress`: the two are sequential states, and amber-for-in-progress is the
 * conventional reading of "someone has this".
 */
const STATUS_STYLES: Record<IssueStatus, string> = {
  unresolved:
    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800",
  in_progress:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  resolved:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  ignored:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",
};

/**
 * `unresolved` is labelled "Open" rather than "Unresolved".
 *
 * It is both the default for a new issue and the backlog, and "Unresolved" reads
 * as a judgement about work not done, where in practice most issues here have
 * never been looked at. "Open" carries the same meaning without the implied
 * reproach.
 */
export const STATUS_LABELS: Record<IssueStatus, string> = {
  unresolved: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  ignored: "Ignored",
};

/**
 * The 3px rail on the left of each list row.
 *
 * Carries the status colour without spending a chip's worth of horizontal space
 * on every row — on a filtered list the chip says the same word nine times,
 * while the rail still separates statuses at a glance on an unfiltered one.
 */
export const STATUS_RAIL: Record<IssueStatus, string> = {
  unresolved: "bg-red-500",
  in_progress: "bg-amber-500",
  resolved: "bg-emerald-500",
  ignored: "bg-zinc-300 dark:bg-zinc-700",
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_STYLES: Record<IssuePriority, string> = {
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  medium: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export function IssuePriorityBadge({ priority }: { priority: IssuePriority }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${PRIORITY_STYLES[priority]}`}
    >
      {priority}
    </span>
  );
}

/**
 * Shown when an issue has come back after being resolved. Deliberately loud —
 * a regression is the single most important thing about an issue's history, and
 * it is otherwise invisible on a row that just reads "Open" again.
 */
export function RegressionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
      title={`Reopened by a recurrence ${count} time${count === 1 ? "" : "s"} after being resolved`}
    >
      ↩ Regressed{count > 1 ? ` ×${count}` : ""}
    </span>
  );
}
