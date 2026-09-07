"use client";

import Link from "next/link";
import { Issue, IssueStatus } from "@/types";
import { ActivityStrip } from "@/components/issue/ActivityStrip";
import { useZoneHref } from "@/hooks/useZoneHref";

/**
 * The issue list.
 *
 * Built as a flat hairline-separated table rather than a stack of bordered
 * cards. A card implies a self-contained object you consider one at a time;
 * triage is the opposite motion — you scan a column looking for the one thing
 * that matters, and every border you cross is friction.
 *
 * Three columns, fixed across every row so the eye can travel straight down
 * each: what broke, when it has been happening, and how much. Only the first is
 * variable-width, because only the first is prose.
 */
export function IssueList({
  issues,
  showStatus,
  selected,
  onToggle,
  dimmed = false,
}: {
  issues: Issue[];
  /** Status dots are redundant when the list is filtered to one status. */
  showStatus: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  dimmed?: boolean;
}) {
  return (
    <ul
      className={`divide-y divide-white/[0.06] border-y border-white/[0.06] transition-opacity ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      {issues.map((issue) => (
        <IssueRow
          key={issue.id}
          issue={issue}
          showStatus={showStatus}
          selected={selected.has(issue.id)}
          onToggle={() => onToggle(issue.id)}
        />
      ))}
    </ul>
  );
}

function IssueRow({
  issue,
  showStatus,
  selected,
  onToggle,
}: {
  issue: Issue;
  showStatus: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const zoned = useZoneHref();
  const title = issue.title || issue.message || issue.name;
  // Events with no distinct message fall back to their name, and printing both
  // would say the same thing twice on one row.
  const showName = issue.name !== title;

  return (
    <li
      className={`group relative flex items-center gap-3 px-3 py-2 transition-colors ${
        selected ? "bg-blue-500/[0.08]" : "hover:bg-white/[0.025]"
      }`}
    >
      {/* Checkbox stays invisible until hover or selection. Bulk actions are the
          rare path, and a column of empty boxes down the left of every row reads
          as clutter on the common one. */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${issue.name}`}
        className={`h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-500 transition-opacity ${
          selected
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      />

      <Link
        href={zoned(`/errors/${issue.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="min-w-0 flex-1">
          {/* Dot sits on the title's baseline rather than the row's centre, so it
              reads as belonging to the message instead of floating between lines. */}
          <p className="flex items-center gap-2 text-[13px] font-medium leading-5 tracking-[-0.01em] text-zinc-100">
            {showStatus && <StatusDot status={issue.status} />}
            <span className="truncate">{title}</span>
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] leading-4 text-zinc-500">
            <span className="shrink-0 text-indigo-400">{issue.service}</span>
            {showName && (
              <span className="truncate font-mono text-zinc-600">
                {issue.name}
              </span>
            )}
            {(issue.priority === "high" || issue.priority === "critical") && (
              // low and medium are the default weight of everything on the page;
              // showing them spends a tag on "this is normal".
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
                {issue.regression_count > 1
                  ? ` ×${issue.regression_count}`
                  : ""}
              </Tag>
            )}
            {issue.links && issue.links.length > 0 && (
              <Tag tone={prTone(issue)}>
                {issue.links.length > 1 ? `${issue.links.length} PRs` : "PR"}
              </Tag>
            )}
            {issue.comment_count ? (
              <span
                className="flex shrink-0 items-center gap-1"
                title={`${issue.comment_count} note${issue.comment_count === 1 ? "" : "s"}`}
              >
                <CommentGlyph />
                {issue.comment_count}
              </span>
            ) : null}
            {issue.assignee && (
              <span className="shrink-0 truncate">
                {issue.assignee.name || issue.assignee.email}
              </span>
            )}
          </div>
        </div>

        {/* Fixed-width so "today" lands on the same x for every row — the strip
            is only readable as a column, not as an isolated graphic. */}
        <ActivityStrip
          history={issue.history}
          className="hidden shrink-0 md:flex"
        />

        <div className="hidden w-24 shrink-0 text-right sm:block">
          <p className="text-[13px] font-medium leading-5 tabular-nums text-zinc-300">
            {formatCount(issue.occurrence_count)}
          </p>
          <p className="text-[11px] leading-4 tabular-nums text-zinc-600">
            {formatRelative(issue.last_seen)}
          </p>
        </div>
      </Link>
    </li>
  );
}

/**
 * Status as a 6px dot rather than a filled chip.
 *
 * A chip repeated down 100 rows becomes a column of shouting; the dot carries
 * the same four-way distinction in a fraction of the space and lets the message
 * hold the row's weight.
 */
function StatusDot({ status }: { status: IssueStatus }) {
  const tone: Record<IssueStatus, string> = {
    unresolved: "bg-rose-400",
    in_progress: "bg-amber-400",
    resolved: "bg-emerald-400",
    ignored: "bg-zinc-600",
  };
  const label: Record<IssueStatus, string> = {
    unresolved: "Open",
    in_progress: "In progress",
    resolved: "Resolved",
    ignored: "Ignored",
  };
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone[status]}`}
      title={label[status]}
      aria-label={label[status]}
    />
  );
}

/** The linked PR's state, so the tag says whether the fix has landed. */
function prTone(issue: Issue): "emerald" | "violet" | "zinc" {
  const links = issue.links ?? [];
  if (links.some((l) => l.merged)) return "violet";
  if (links.some((l) => l.state === "open")) return "emerald";
  return "zinc";
}

function CommentGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden>
      <path
        d="M1.5 3.2A1.7 1.7 0 0 1 3.2 1.5h5.6a1.7 1.7 0 0 1 1.7 1.7v3.4a1.7 1.7 0 0 1-1.7 1.7H5l-2.6 2v-2h-.9V3.2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tag({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: "amber" | "violet" | "zinc" | "rose" | "emerald";
  title?: string;
}) {
  const tones = {
    amber: "border-amber-400/25 text-amber-300/90",
    violet: "border-violet-400/25 text-violet-300/90",
    rose: "border-rose-400/30 text-rose-300/90",
    emerald: "border-emerald-400/25 text-emerald-300/90",
    zinc: "border-white/10 text-zinc-400",
  };
  return (
    <span
      title={title}
      className={`shrink-0 rounded border px-1 py-px text-[10px] font-medium uppercase leading-[14px] tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Compact, so a five-figure count does not widen the column. */
export function formatCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatRelative(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.round(days / 365)}y`;
}
