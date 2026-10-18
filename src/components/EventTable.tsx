"use client";

import { Event } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToCSV, exportToJSON } from "@/tools/export.tools";
import { formatDateTime, useDateTimePrefs, type DateTimePrefs } from "@/tools/datetime.tools";

interface EventTableProps {
  events: Event[];
  loading: boolean;
  onSelectEvent: (event: Event, index: number) => void;
  /** The keyboard cursor (j/k). Highlighted, and where Enter opens. */
  activeIndex?: number | null;
  /**
   * How many rows the first-load skeleton draws — the page size, so the
   * placeholder is as tall as the page it stands in for.
   */
  skeletonRows?: number;
}

function getLevelColor(level?: string) {
  switch (level?.toLowerCase()) {
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 ring-1 ring-inset ring-red-200 dark:ring-red-900";
    case "warn":
    case "warning":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-900";
    case "debug":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700";
    case "info":
    default:
      return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 ring-1 ring-inset ring-blue-200 dark:ring-blue-900";
  }
}

/**
 * An event's date and time-of-day under the user's date/time preferences
 * (timezone, ISO vs locale, 12/24h — set on /settings). `formatDateTime` stops
 * at minutes and an event table without seconds is useless, so the time half is
 * built here with the same zone and hour cycle; the date half IS
 * `formatDateTime`. The table, the detail panel and the chart above them all
 * read this, so they can never disagree about which zone they are in. The raw
 * ISO timestamp stays the value for copy, JSON, exports and links.
 */
export function formatEventTimestamp(
  ts: string,
  prefs: DateTimePrefs,
  { ms = false }: { ms?: boolean } = {},
): { date: string; time: string } {
  const d = new Date(ts);
  // Formatting fallback: show the raw timestamp. Not a failure.
  if (Number.isNaN(d.getTime())) return { date: ts, time: "" };
  const iso = prefs.format === "iso";
  const time = new Intl.DateTimeFormat(iso ? "en-GB" : "en-US", {
    timeZone: prefs.timeZone === "local" ? undefined : prefs.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(ms ? { fractionalSecondDigits: 3 as const } : {}),
    hourCycle: iso || prefs.hourCycle === "24" ? "h23" : "h12",
  }).format(d);
  return { date: formatDateTime(d, prefs, { dateOnly: true }), time };
}

function flattenEvent(event: Event): Record<string, unknown> {
  const { data, ...rest } = event;
  const flat: Record<string, unknown> = { ...rest };
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      flat[`data.${key}`] = typeof value === "object" ? JSON.stringify(value) : value;
    }
  }
  return flat;
}

/** The accessible name of a row's open button: what, and when. */
function openLabel(event: Event, time: string) {
  return `Open event ${event.name} at ${time}`;
}

/**
 * The open buttons carry their row index, so the page's j/k shortcut can move
 * focus without holding a ref per row. Desktop and mobile both render; the page
 * picks the visible one.
 */
export const EVENT_ROW_ATTR = "data-event-row";

export function EventTable({ events, loading, onSelectEvent, activeIndex = null, skeletonRows = 25 }: EventTableProps) {
  const prefs = useDateTimePrefs();
  const handleExportCSV = () => {
    exportToCSV(events.map(flattenEvent), `events-${new Date().toISOString().slice(0, 10)}`);
  };

  const handleExportJSON = () => {
    exportToJSON(events as unknown as Record<string, unknown>[], `events-${new Date().toISOString().slice(0, 10)}`);
  };

  // ⚠️ THE PLACEHOLDER IS FOR A FIRST LOAD ONLY. It used to replace the rows on
  // every fetch, so each AutoRefresh tick collapsed the page from thousands of
  // pixels to one screen and threw a reader scrolled to row 50 back to the top.
  // A refresh keeps the rows on screen; the Refresh button's spinning arrow
  // says it is running. A first load gets a skeleton the height of the page.
  if (loading && events.length === 0) {
    return <EventTableSkeleton rows={skeletonRows} />;
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
        <div className="w-16 h-16 mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-base font-medium text-zinc-600 dark:text-zinc-400">
          No events found
        </p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <>
      {/* Export buttons */}
      {events.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 justify-end">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </button>
          <button
            onClick={handleExportJSON}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            JSON
          </button>
        </div>
      )}

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto" aria-busy={loading || undefined}>
        <table className="w-full text-sm">
          <EventTableHead />
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {events.map((event, index) => {
              const ts = formatEventTimestamp(event.timestamp, prefs);
              const active = activeIndex === index;
              return (
                // The row stays clickable for the mouse; the keyboard and
                // screen-reader path is the named button in the last cell — a
                // <tr> with only an onClick was unreachable without a mouse.
                <tr
                  key={`event-${index}`}
                  className={`group cursor-pointer transition-colors ${
                    active
                      ? "bg-blue-50/70 dark:bg-blue-900/20"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                  onClick={() => onSelectEvent(event, index)}
                >
                  <td className={`px-4 py-3 ${active ? "shadow-[inset_3px_0_0_0] shadow-blue-500" : ""}`}>
                    <time dateTime={event.timestamp} title={event.timestamp} className="flex flex-col">
                      <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100">
                        {ts.time}
                      </span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {ts.date}
                      </span>
                    </time>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-md">
                      {event.service}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                    {event.name}
                  </td>
                  <td className="px-4 py-3">
                    {event.level && (
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-md ${getLevelColor(event.level)}`}
                      >
                        {event.level}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {event.user_id ? event.user_id.slice(0, 8) : "-"}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      data-event-row={index}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(event, index);
                      }}
                      aria-label={openLabel(event, `${ts.date} ${ts.time}`)}
                      title="Open event"
                      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <svg aria-hidden className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View — each card is one button. */}
      <ul className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800" aria-busy={loading || undefined}>
        {events.map((event, index) => {
          const ts = formatEventTimestamp(event.timestamp, prefs);
          return (
            <li key={`mobile-${index}`}>
              <button
                type="button"
                data-event-row={index}
                onClick={() => onSelectEvent(event, index)}
                aria-label={openLabel(event, `${ts.date} ${ts.time}`)}
                className={`block w-full px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                  activeIndex === index ? "bg-blue-50/70 dark:bg-blue-900/20" : "active:bg-zinc-50 dark:active:bg-zinc-800/50"
                }`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 mb-1">
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded truncate">
                        {event.service}
                      </span>
                      {event.level && (
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${getLevelColor(event.level)}`}
                        >
                          {event.level}
                        </span>
                      )}
                    </span>
                    <span className="block font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {event.name}
                    </span>
                    <span className="block mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {ts.time} · {ts.date}
                    </span>
                  </span>
                  <svg aria-hidden className="w-4 h-4 mt-1 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The real column headers, shared with the skeleton so its columns line up. */
function EventTableHead() {
  return (
    <thead>
      <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Time
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Service
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Event
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Level
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          User
        </th>
        <th className="px-4 py-3 w-10">
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

// Varying widths so the placeholder reads as rows of text, not stripes.
const NAME_W = [62, 48, 74, 55, 68, 44, 58, 70];
const SERVICE_W = [72, 56, 64, 80, 60, 68];

/**
 * The first-load placeholder: the export bar, the real <thead>, and `rows`
 * rows at the real row height — 56px on desktop (py-3 around a two-line
 * time cell), 92px for the phone card — so nothing jumps when events land.
 * ⚠️ If a real row's padding or line count changes, change these heights with
 * it; a skeleton of the wrong height is the jump it exists to prevent.
 */
function EventTableSkeleton({ rows }: { rows: number }) {
  const indices = Array.from({ length: rows }, (_, i) => i);
  return (
    <div role="status" aria-label="Loading events">
      {/* Stands in for the CSV/JSON bar, which renders with the first row. */}
      <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 justify-end" aria-hidden>
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-6 w-14" />
      </div>

      <div className="hidden md:block overflow-x-auto" aria-hidden>
        <table className="w-full text-sm">
          <EventTableHead />
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {indices.map((i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <div className="flex h-8 flex-col justify-center gap-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-16 bg-zinc-100 dark:bg-zinc-800/60" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-6 rounded-md" style={{ width: `${SERVICE_W[i % SERVICE_W.length]}px` }} />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-3.5" style={{ width: `${NAME_W[i % NAME_W.length]}%` }} />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-11 rounded-md" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-3 w-14 bg-zinc-100 dark:bg-zinc-800/60" />
                </td>
                <td className="px-2 py-1.5 w-10" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800" aria-hidden>
        {indices.map((i) => (
          <li key={i} className="px-4 py-3">
            <div className="mb-1 flex h-5 items-center gap-2">
              <Skeleton className="h-5 rounded" style={{ width: `${SERVICE_W[i % SERVICE_W.length]}px` }} />
              <Skeleton className="h-5 w-11 rounded" />
            </div>
            <div className="flex h-6 items-center">
              <Skeleton className="h-4" style={{ width: `${NAME_W[i % NAME_W.length]}%` }} />
            </div>
            <div className="mt-1 flex h-4 items-center">
              <Skeleton className="h-3 w-36 bg-zinc-100 dark:bg-zinc-800/60" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
