"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAnglesLeft,
  faAnglesRight,
  faChevronLeft,
  faChevronRight,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { Event } from "@/types";
import { getEvents } from "@/services/api";
import { Modal } from "@/components/ui/modal";
import { FailureNote } from "@/components/FailureState";
import { copyText } from "@/tools/clipboard.tools";
import { reportError } from "@/services/monitor.service";

/**
 * How a stored event is read on the issue page: the row summary, the payload
 * (stack traces as real multi-line blocks, scalars as a tag table) and the
 * prev/next drawer over the issue's loaded occurrences.
 *
 * ⚠️ Every value here is untrusted text from whatever service emitted the
 * event. It is rendered as React text children only — never innerHTML.
 */

/** Keys whose string value is a trace even when it happens to be one line. */
const STACK_KEYS = /^(stack|stacktrace|stack_trace|traceback|trace|panic_stack|error_stack)$/i;

/** Top-level event columns worth showing as tags. `service`/`name` are the issue's own. */
const COLUMN_TAGS = ["env", "request_id", "trace_id", "job_id", "user_id"] as const;

/** A scalar longer than this goes to "Other data" rather than the tag table. */
const MAX_TAG_LENGTH = 240;

type Scalar = string | number | boolean;

function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * A string that should render as a stack. Producers that double-encode leave
 * literal `\n` sequences rather than newlines; those are decoded for display.
 */
function asStack(key: string, value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  let text = value;
  if (!text.includes("\n") && text.includes("\\n")) {
    text = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  if (STACK_KEYS.test(key)) return text;
  // An unnamed field that is clearly a multi-frame trace.
  const lines = text.split("\n");
  if (lines.length >= 3 && lines.some((l) => /^\s+at\s|^\s*File "|\.go:\d+/.test(l))) {
    return text;
  }
  return null;
}

/** The first useful string in the payload, so a row says more than its timestamp. */
export function eventPreview(event: Event): string {
  const d = event.data ?? {};
  for (const key of ["error", "message", "error_message"]) {
    if (typeof d[key] === "string" && d[key]) return d[key] as string;
  }
  return "";
}

/** Scalar tags from the columns and the payload, in a stable order. */
export function eventTags(event: Event): [string, Scalar][] {
  const tags: [string, Scalar][] = [];
  for (const key of COLUMN_TAGS) {
    const v = event[key];
    if (v) tags.push([key, v]);
  }
  const data = event.data ?? {};
  for (const key of Object.keys(data).sort()) {
    const v = data[key];
    if (!isScalar(v) || asStack(key, v) !== null) continue;
    if (typeof v === "string" && v.length > MAX_TAG_LENGTH) continue;
    tags.push([`data.${key}`, v]);
  }
  return tags;
}

/**
 * Tag keys whose value differs across the loaded events — what actually tells
 * two occurrences apart. Two events a millisecond apart with the same message
 * are NOT duplicates (one per container is common), and a row that shows only
 * the timestamp and message makes them look like one.
 *
 * Fields that vary on every event without distinguishing a source (durations,
 * suppression counters) are left out.
 */
const NOISY_KEYS = /(^|\.)(duration_ms|elapsed_ms|latency_ms|suppressed|attempt|ts|time|timestamp)$/;
const PREFERRED_KEYS = [
  "data.container_name",
  "data.container",
  "data.host",
  "data.hostname",
  "data.pod",
  "data.instance",
  "env",
  "data.zone",
  "request_id",
];

export function distinguishingKeys(events: Event[], max = 2): string[] {
  if (events.length < 2) return [];
  const values = new Map<string, Set<string>>();
  for (const e of events) {
    for (const [k, v] of eventTags(e)) {
      if (NOISY_KEYS.test(k)) continue;
      if (!values.has(k)) values.set(k, new Set());
      values.get(k)!.add(String(v));
    }
  }
  const varying = [...values.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([k]) => k);
  const rank = (k: string) => {
    const i = PREFERRED_KEYS.indexOf(k);
    return i === -1 ? PREFERRED_KEYS.length : i;
  };
  return varying.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, max);
}

export function tagValue(event: Event, key: string): string | undefined {
  if (key.startsWith("data.")) {
    const v = event.data?.[key.slice(5)];
    return isScalar(v) ? String(v) : undefined;
  }
  const v = event[key as keyof Event];
  return typeof v === "string" && v ? v : undefined;
}

/** Full date with year and milliseconds — occurrences are often 1 ms apart. */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${date}, ${time}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------------ */

const LIBRARY_FRAME = /node_modules|node:internal|\(node:|internal\/|\/usr\/local\/go\/|^\s*runtime\/|\/runtime\/|site-packages|<anonymous>/;
const FRAME = /^\s+at\s|^\s*File "|^\s*\S+\.go:\d+|^\t/;

/**
 * A stack trace as lines, with runs of library frames (node_modules,
 * node:internal, Go runtime, site-packages) folded behind a toggle so the
 * application's own frames are what the eye lands on.
 */
export function StackBlock({ label, text }: { label: string; text: string }) {
  const [showAll, setShowAll] = useState(false);
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // Group consecutive library frames so each run folds as one.
  type Chunk = { kind: "line"; text: string; app: boolean } | { kind: "lib"; lines: string[] };
  const chunks: Chunk[] = [];
  for (const line of lines) {
    const isFrame = FRAME.test(line);
    if (isFrame && LIBRARY_FRAME.test(line)) {
      const last = chunks[chunks.length - 1];
      if (last?.kind === "lib") last.lines.push(line);
      else chunks.push({ kind: "lib", lines: [line] });
    } else {
      chunks.push({ kind: "line", text: line, app: isFrame });
    }
  }
  const hidden = chunks.reduce((n, c) => n + (c.kind === "lib" ? c.lines.length : 0), 0);

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
        <span className="font-mono text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <div className="flex items-center gap-3">
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-pressed={showAll}
              className="rounded text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-blue-400"
            >
              {showAll ? "Hide library frames" : `Show ${hidden} library frame${hidden === 1 ? "" : "s"}`}
            </button>
          )}
          <CopyIconButton label={`Copy ${label}`} text={text} />
        </div>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-xs leading-relaxed">
        {chunks.map((chunk, i) =>
          chunk.kind === "line" ? (
            <span
              key={i}
              className={
                chunk.app
                  ? "block font-medium text-zinc-900 dark:text-zinc-100"
                  : "block text-zinc-700 dark:text-zinc-300"
              }
            >
              {chunk.text || " "}
            </span>
          ) : showAll ? (
            chunk.lines.map((l, j) => (
              <span key={`${i}-${j}`} className="block text-zinc-400 dark:text-zinc-500">
                {l}
              </span>
            ))
          ) : (
            <span key={i} className="block select-none italic text-zinc-400 dark:text-zinc-500">
              {"    "}… {chunk.lines.length} library frame{chunk.lines.length === 1 ? "" : "s"}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

export function CopyIconButton({ label, text }: { label: string; text: string | (() => string) }) {
  return (
    <button
      type="button"
      onClick={() => void copyText(typeof text === "function" ? text() : text, { label })}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
    >
      <FontAwesomeIcon icon={faCopy} className="h-3 w-3" />
    </button>
  );
}

/** The whole payload, readable: stacks, then tags, then whatever is left. */
export function EventPayload({ event }: { event: Event }) {
  const data = event.data ?? {};
  const stacks: [string, string][] = [];
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) {
    const v = data[key];
    const stack = asStack(key, v);
    if (stack !== null) stacks.push([key, stack]);
    else if (!isScalar(v) || (typeof v === "string" && v.length > MAX_TAG_LENGTH)) rest[key] = v;
  }
  const tags = eventTags(event);
  const restKeys = Object.keys(rest);

  return (
    <div className="space-y-3">
      {stacks.map(([key, text]) => (
        <StackBlock key={key} label={key} text={text} />
      ))}

      {tags.length > 0 && (
        <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-white/[0.08]">
          <table className="w-full text-xs">
            <caption className="sr-only">Event tags</caption>
            <tbody>
              {tags.map(([k, v]) => (
                <tr key={k} className="border-b border-zinc-100 last:border-b-0 dark:border-white/[0.04]">
                  <th scope="row" className="w-1/3 px-2.5 py-1 text-left align-top font-mono font-normal text-zinc-500 dark:text-zinc-400">
                    {k}
                  </th>
                  <td className="break-all px-2.5 py-1 font-mono text-zinc-800 dark:text-zinc-200">
                    {String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restKeys.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Other data</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-200 px-2.5 py-2 font-mono text-xs text-zinc-700 dark:border-white/[0.08] dark:text-zinc-300">
            {JSON.stringify(rest, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void copyText(JSON.stringify(event, null, 2), { label: "Event JSON" })}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-white/[0.1] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
        >
          <FontAwesomeIcon icon={faCopy} className="h-3 w-3" />
          Copy event JSON
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * One occurrence in a dialog, with Latest · Newer · Older · Oldest over the
 * events the page has loaded (newest first). ←/→ step too.
 *
 * The bounds are the LOADED events, not the issue's whole history — the API
 * returns at most the newest 500 and has no offset — so the header says
 * "of N loaded" rather than implying N is everything.
 */
export function EventDrawer({
  events,
  index,
  onIndexChange,
  onClose,
  canLoadMore,
}: {
  events: Event[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  canLoadMore: boolean;
}) {
  const open = index !== null && events[index] !== undefined;
  const event = open ? events[index!] : null;
  const last = events.length - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowLeft" && index! > 0) onIndexChange(index! - 1);
      if (e.key === "ArrowRight" && index! < last) onIndexChange(index! + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, last, onIndexChange]);

  const nav = (label: string, icon: typeof faChevronLeft, to: number, disabled: boolean) => (
    <button
      type="button"
      onClick={() => onIndexChange(to)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.1] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
    >
      <FontAwesomeIcon icon={icon} className="h-3 w-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClass="max-w-3xl"
      title={event ? `Occurrence · ${formatEventTime(event.timestamp)}` : "Occurrence"}
      description={
        event
          ? `${index! + 1} of ${events.length} loaded, newest first${index === last && canLoadMore ? " — load more events on the page to go further back" : ""}. ← and → step between them.`
          : undefined
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-white/[0.1] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
        >
          Close
        </button>
      }
    >
      {event && (
        <div className="space-y-4">
          <nav aria-label="Occurrences" className="flex flex-wrap items-center gap-1.5">
            {nav("Latest", faAnglesLeft, 0, index === 0)}
            {nav("Newer", faChevronLeft, index! - 1, index === 0)}
            {nav("Older", faChevronRight, index! + 1, index === last)}
            {nav("Oldest", faAnglesRight, last, index === last)}
          </nav>
          {eventPreview(event) && (
            <p className="break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {eventPreview(event)}
            </p>
          )}
          {/* Keyed so a step to another occurrence starts the trace fresh. */}
          <EventPayload key={`${event.timestamp}-${index}`} event={event} />
          {event.trace_id && <TraceEvents key={`${event.trace_id}-${index}`} event={event} />}
        </div>
      )}
    </Modal>
  );
}

/** Every event sharing this occurrence's trace id, loaded on demand. */
function TraceEvents({ event }: { event: Event }) {
  const [rows, setRows] = useState<Event[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const t = new Date(event.timestamp).getTime();
      const res = await getEvents({
        trace_id: event.trace_id,
        limit: 100,
        // ±1 day: the events read is never sent unbounded (AGENTS §8).
        from: new Date(t - 86_400_000).toISOString(),
        to: new Date(t + 86_400_000).toISOString(),
      });
      if (!res.success) {
        setError(res.error_message || "The request failed.");
        return;
      }
      setRows(
        [...(res.data ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      );
    } catch (err) {
      reportError("issue_event.trace.load.failed", err, {
        trace_id: event.trace_id,
        outcome: "trace section shows its failure note",
      });
      setError("Failed to load the trace");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label="Trace" className="rounded-md border border-zinc-200 p-2.5 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Trace <span className="font-mono">{event.trace_id}</span>
        </p>
        {rows === null && !error && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded text-xs font-medium text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:opacity-50 dark:text-blue-400"
          >
            {loading ? "Loading…" : "Show events in this trace"}
          </button>
        )}
      </div>
      {error ? (
        <div className="mt-2">
          <FailureNote what="the trace" message={error} onRetry={() => void load()} />
        </div>
      ) : rows !== null ? (
        rows.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">No events in this trace within a day of this occurrence.</p>
        ) : (
          <ol className="mt-2 space-y-0.5 font-mono text-xs">
            {rows.map((r, i) => (
              <li key={`${r.timestamp}-${i}`} className="flex gap-2 text-zinc-700 dark:text-zinc-300">
                <span className="shrink-0 text-zinc-500">{formatEventTime(r.timestamp).split(", ").pop()}</span>
                <span className="shrink-0 text-indigo-500 dark:text-indigo-400">{r.service}</span>
                <span className="min-w-0 truncate">{r.name}</span>
                {r.level && <span className="ml-auto shrink-0 text-zinc-500">{r.level}</span>}
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}
