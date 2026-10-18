"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faLink } from "@fortawesome/free-solid-svg-icons";
import { Event, EventQueryParams, Pagination, AnalyticsFilter } from "@/types";
import { getEvents } from "@/services/api";
import { EventFilters, EVENT_SEARCH_INPUT_ID } from "@/components/EventFilters";
import { EventTable, EVENT_ROW_ATTR } from "@/components/EventTable";
import { EventTimeRangeChart } from "@/components/EventTimeRangeChart";
import { EventDetailPanel } from "@/components/EventDetailPanel";
import { AutoRefresh, INTERVALS } from "@/components/AutoRefresh";
import { SavedViews } from "@/components/SavedViews";
import { FailureState } from "@/components/FailureState";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeRangePicker } from "@/components/analytics/TimeRangePicker";
import { reportError } from "@/services/monitor.service";
import {
  relativeFrom,
  TIME_RANGES,
  isCustomRange,
  customRange,
  rangeFromParam,
  rangeToParam,
  type TimeRange,
} from "@/tools/timeRange.tools";
import { useUrlState, urlInt, urlString, type UrlCodec } from "@/hooks/useUrlState";
import { copyText } from "@/tools/clipboard.tools";
import { formatDateTime, useDateTimePrefs } from "@/tools/datetime.tools";
import { useRegisterShortcuts, type Shortcut } from "@/components/ShortcutHelp";

// ─── URL state ──────────────────────────────────────────────────────────────
//
// ⚠️ EVERY PIECE OF THE QUERY LIVES IN THE URL. It all used to be useState, so a
// reload, Back, or a link pasted to a teammate dropped the filters and landed
// on the unfiltered 24h — for an observability tool, "look at this" is the core
// workflow. The params: `range` (preset or custom), `from`/`to` (a brush zoom
// inside it), `level`, `q` (the search chips), `limit`, `offset`, `event` (the
// open detail panel) and `refresh` (the auto-refresh interval).
//
// ⚠️ `service`, `name`, `level` and `from`/`to` ARE ALSO THE DEEP-LINK CONTRACT.
// Other pages link here with them — an alert incident's window, an analytics
// Top-N row, an issue's "View in Events" — so they stay plain top-level params
// (`/appleby?service=api&level=error&from=…&to=…`), not buried inside `q`.
// `from`/`to` is the brush-zoom pair, ISO or epoch milliseconds; both or
// neither. Renaming any of them breaks links this page never sees being built.

const DEFAULT_RANGE = "24h";

/** A preset spec or `<fromISO>..<toISO>`. Anything else reads as the default. */
const rangeCodec: UrlCodec<string> = {
  parse: (raw) => (rangeFromParam(raw) ? raw : undefined),
  serialize: (value) => value,
};

/** Keys that are page state of their own, never a chip. */
const NON_CHIP_KEYS = new Set(["level", "limit", "offset", "from", "to", "range"]);

/**
 * The search chips as ONE param holding a nested query string —
 * `?q=service%3Dapi%26name__contains%3Dlogin`. One key because the chip keys
 * are open-ended (`data.anything__gte`), and `useUrlState` owns one key per
 * hook; nested rather than flat so a chip named `range` or `offset` can never
 * collide with the page's own params.
 */
type Chips = Record<string, string>;
const EMPTY_CHIPS: Chips = {};
const chipsCodec: UrlCodec<Chips> = {
  parse: (raw) => {
    const out: Chips = {};
    new URLSearchParams(raw).forEach((value, key) => {
      if (!NON_CHIP_KEYS.has(key) && value !== "") out[key] = value;
    });
    return out;
  },
  serialize: (chips) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(chips)) {
      if (value !== "") params.append(key, value);
    }
    return params.toString() || null;
  },
};

/**
 * The two chips with a param of their own, for the deep links above. Reading
 * them back out of `q` still works (links copied before they were split out);
 * every write moves them to their own key.
 */
const OWN_PARAM_CHIPS = ["service", "name"] as const;

/**
 * A zoom edge: an ISO timestamp, or epoch milliseconds from a page that has a
 * number to hand. Normalised to ISO so the request, the chart and a saved view
 * all see one spelling; anything unparseable reads as no zoom.
 */
const instantCodec: UrlCodec<string> = {
  parse: (raw) => {
    if (/^\d{10,}$/.test(raw)) {
      const d = new Date(Number(raw));
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return Number.isNaN(Date.parse(raw)) ? undefined : raw;
  },
  serialize: (value) => value,
};

const PAGE_SIZES = [25, 50, 100, 250, 500];
/** 0 = not chosen, so the viewport default applies. */
const limitCodec: UrlCodec<number> = {
  parse: (raw) => {
    const n = urlInt.parse(raw);
    return n !== undefined && PAGE_SIZES.includes(n) ? n : undefined;
  },
  serialize: (value) => String(value),
};

const refreshCodec: UrlCodec<number> = {
  parse: (raw) => {
    const n = urlInt.parse(raw);
    return n !== undefined && INTERVALS.some((i) => i.seconds === n) ? n : undefined;
  },
  serialize: (value) => String(value),
};

// ─── Phone width ────────────────────────────────────────────────────────────
//
// Below `sm` an event is a ~130px card, so 100 per page was a 22,000px page.
// The default drops to 25 there. Read through useSyncExternalStore so the server
// render (which cannot know) and hydration agree, then the client corrects.

const NARROW_QUERY = "(max-width: 639px)";
function subscribeNarrow(onChange: () => void) {
  const mql = window.matchMedia(NARROW_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// ─── The open event ─────────────────────────────────────────────────────────
//
// Events have no id, so the `event` param names one by what does identify it:
// `timestamp|service|name`. A deep link to an event not on the current page is
// looked up by exactly that (see the lookup effect).

function eventKeyOf(e: Event): string {
  return `${e.timestamp}|${e.service}|${e.name}`;
}

function parseEventKey(key: string) {
  const i = key.indexOf("|");
  const j = key.indexOf("|", i + 1);
  if (i < 0 || j < 0) return null;
  const timestamp = key.slice(0, i);
  if (Number.isNaN(Date.parse(timestamp))) return null;
  return { timestamp, service: key.slice(i + 1, j), name: key.slice(j + 1) };
}

/** A visible row's open button, so j/k can move focus to it. */
function focusRow(index: number | null) {
  if (index === null) return;
  const buttons = document.querySelectorAll<HTMLElement>(`[${EVENT_ROW_ATTR}="${index}"]`);
  // Desktop and mobile layouts both render; only one is displayed.
  Array.from(buttons)
    .find((b) => b.offsetParent !== null)
    ?.focus();
}

/**
 * What the keydown handler below answers to, listed in the "?" overlay while
 * this page is mounted. Keep the two in step: a key listed here that the
 * handler dropped is worse than an unlisted one.
 */
const EVENTS_SHORTCUTS: Shortcut[] = [
  { keys: ["/"], description: "Focus the search box" },
  { keys: ["j"], description: "Next event (steps the open panel)" },
  { keys: ["k"], description: "Previous event (steps the open panel)" },
  { keys: ["Enter"], description: "Open the highlighted event" },
  { keys: ["Esc"], description: "Close the event panel" },
];

/**
 * The question a total answers: every filter and the window, but NOT the page
 * (offset/limit) — page 2 has the same total as page 1, so paging must not
 * blank the count.
 */
function totalKeyOf(filters: EventQueryParams, range: TimeRange, zoomFrom: string, zoomTo: string): string {
  const { offset: _offset, limit: _limit, ...rest } = filters;
  void _offset;
  void _limit;
  return JSON.stringify([rest, rangeToParam(range), zoomFrom, zoomTo]);
}

export default function Home() {
  const [events, setEvents] = useState<Event[]>([]);
  // True from the first render: the mount effect fetches straight away, and
  // starting false painted "No events found" for a frame before it did.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  /**
   * Which question `pagination` answers (see `totalKeyOf`). ⚠️ The header used
   * to print the last total under the NEW range's label while the new range
   * loaded — "100 of 231,168 events · last 7d" when 231,168 was the 24h total.
   * The count is shown only when it answers the question currently on screen.
   */
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);

  const [rangeParam, setRangeParam] = useUrlState("range", rangeCodec, {
    default: DEFAULT_RANGE,
    history: "push",
  });
  const [zoomFrom, setZoomFrom] = useUrlState("from", instantCodec, { default: "", history: "push" });
  const [zoomTo, setZoomTo] = useUrlState("to", instantCodec, { default: "", history: "push" });
  const [level, setLevel] = useUrlState("level", urlString, { default: "", history: "push" });
  const [service, setService] = useUrlState("service", urlString, { default: "", history: "push" });
  const [name, setName] = useUrlState("name", urlString, { default: "", history: "push" });
  const [qChips, setQChips] = useUrlState("q", chipsCodec, { default: EMPTY_CHIPS, history: "push" });
  const [limitParam, setLimitParam] = useUrlState("limit", limitCodec, { default: 0 });
  const [offset, setOffset] = useUrlState("offset", urlInt, { default: 0, history: "push" });
  const [eventKey, setEventKey] = useUrlState("event", urlString, { default: "", history: "push" });
  const [refreshSeconds, setRefreshSeconds] = useUrlState("refresh", refreshCodec, { default: 0 });

  const dateTimePrefs = useDateTimePrefs();
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
  const limit = limitParam || (narrow ? 25 : 100);

  const range: TimeRange = useMemo(
    () => rangeFromParam(rangeParam) ?? rangeFromParam(DEFAULT_RANGE)!,
    [rangeParam],
  );
  // A reversed or empty pair is no zoom rather than a query for nothing.
  const zoom =
    zoomFrom && zoomTo && Date.parse(zoomFrom) < Date.parse(zoomTo)
      ? { from: zoomFrom, to: zoomTo }
      : null;

  /** Every chip, wherever its param lives. The own-param ones win over `q`. */
  const chips: Chips = useMemo(
    () => ({ ...qChips, ...(service ? { service } : {}), ...(name ? { name } : {}) }),
    [qChips, service, name],
  );
  /** Writes a whole chip set, routing `service`/`name` to their own params. */
  const setChips = useCallback(
    (next: Chips) => {
      const rest = { ...next };
      for (const key of OWN_PARAM_CHIPS) delete rest[key];
      setService(next.service ?? "");
      setName(next.name ?? "");
      setQChips(rest);
    },
    [setService, setName, setQChips],
  );

  /**
   * The window the table AND the chart read, resolved by fetchEvents. One
   * resolution, so the two can never show different spans (EVENTS-03).
   */
  const [queryWindow, setQueryWindow] = useState<{ from: string; to: string } | null>(null);
  /**
   * "Now" for a relative range, fixed per query. Paging keeps it, so page 2 is
   * the next 100 of the SAME result set rather than of a window that moved on
   * while page 1 was being read; everything else (a new filter, Refresh,
   * AutoRefresh) takes a fresh one.
   */
  const anchorRef = useRef<Date | null>(null);
  const keepAnchorRef = useRef(false);

  /** The detail panel's event when it came from the table or a lookup. */
  const [pinned, setPinned] = useState<Event | null>(null);
  /** The j/k cursor. */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** The cursor as of the last commit, for handlers that run outside render. */
  const activeIndexRef = useRef<number | null>(null);

  /**
   * Bumped by every fetchEvents call; a response that is no longer the newest
   * is dropped. Several things call fetchEvents (the URL state, the Search
   * button, AutoRefresh, Refresh/Retry), so an effect-local `cancelled` flag
   * cannot see them all — and without this a slow auto-refresh for the
   * previous range could land after the new range's answer and fill the table
   * with the wrong window.
   */
  const fetchGenRef = useRef(0);

  // The filters in EventFilters' shape: level, page size, offset and the chips.
  const filters: EventQueryParams = useMemo(
    () => ({ ...chips, level: level || undefined, limit, offset }),
    [chips, level, limit, offset],
  );

  // Convert the filters to AnalyticsFilter[] for the chart
  const analyticsFilters: AnalyticsFilter[] = useMemo(() => {
    const result: AnalyticsFilter[] = [];

    if (level) {
      result.push({ field: "level", operator: "eq", value: level });
    }

    Object.entries(chips).forEach(([key, value]) => {
      // Parse Django-style filter key
      const operators = [
        "neq",
        "lte",
        "gte",
        "lt",
        "gt",
        "contains",
        "startswith",
        "endswith",
        "in",
        "eq",
      ];
      let field = key;
      let operator: AnalyticsFilter["operator"] = "eq";

      for (const op of operators) {
        if (key.endsWith(`__${op}`)) {
          field = key.slice(0, -(op.length + 2));
          operator = op as AnalyticsFilter["operator"];
          break;
        }
      }

      result.push({ field, operator, value });
    });

    return result;
  }, [chips, level]);

  const fetchEvents = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    if (!keepAnchorRef.current || !anchorRef.current) anchorRef.current = new Date();
    keepAnchorRef.current = false;
    const anchor = anchorRef.current;

    // ⚠️ THE WINDOW IS RESOLVED HERE, AT REQUEST TIME, NEVER STORED IN THE URL.
    // A zoom or a custom range is absolute because the user asked for one; a
    // preset is the spec ("24h"), turned into timestamps only now — a stored
    // `from` would freeze AutoRefresh on the old window, and a saved view
    // would reopen last week next week. Without any `from`, the count() and
    // ORDER BY behind this request scanned the whole 30-day project.
    const w = zoom
      ? zoom
      : isCustomRange(range)
        ? { from: range.from, to: range.to }
        : { from: relativeFrom(range.from, anchor), to: anchor.toISOString() };
    setQueryWindow((prev) => (prev && prev.from === w.from && prev.to === w.to ? prev : w));

    const key = totalKeyOf(filters, range, zoomFrom, zoomTo);

    setLoading(true);
    setError(null);
    try {
      const response = await getEvents({ ...filters, from: w.from, to: w.to });
      if (gen !== fetchGenRef.current) return;
      if (!response.success) {
        // Explicit: the client no longer throws on a non-2xx, so the catch below
        // is unreachable for HTTP failures and a failing API would render as an
        // empty event list.
        setError(response.error_message || "Failed to fetch events");
        setEvents([]);
        setPagination(null);
        return;
      }
      setEvents(response.data);
      setPagination(response.pagination ?? null);
      setAnsweredKey(key);
    } catch (err) {
      // Reported before the staleness guard: a throw is a real failure whether
      // or not its request has since been superseded, and the guard below only
      // governs what reaches the screen.
      reportError("events.load.failed", err, {
        filter_keys: Object.keys(filters).join(","),
        outcome: "events page shows its failure state",
      });
      if (gen !== fetchGenRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      setEvents([]);
    } finally {
      // Only the newest request owns the spinner; a superseded one finishing
      // first must not clear it while the current one is still loading.
      if (gen === fetchGenRef.current) setLoading(false);
    }
    // `zoom` is rebuilt every render; its two strings are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, range, zoomFrom, zoomTo]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // ─── Changing the query ─────────────────────────────────────────────────
  // Setters fired in one handler coalesce into one history entry.

  const clearZoom = () => {
    setZoomFrom("");
    setZoomTo("");
  };

  const handleRangeChange = (next: TimeRange) => {
    const param = rangeToParam(next);
    // The same preset again is a request for "now": refetch in place.
    if (param === rangeParam && !zoom) {
      void fetchEvents();
      return;
    }
    setRangeParam(param);
    clearZoom();
    setOffset(0);
  };

  const handleZoom = useCallback(
    (from: string, to: string) => {
      setZoomFrom(from);
      setZoomTo(to);
      setOffset(0);
    },
    [setZoomFrom, setZoomTo, setOffset],
  );

  // Back to the selected range from a brush zoom: the table follows the
  // RELATIVE window again (see fetchEvents).
  const handleZoomReset = useCallback(() => {
    setZoomFrom("");
    setZoomTo("");
    setOffset(0);
  }, [setZoomFrom, setZoomTo, setOffset]);

  /** EventFilters hands back the whole filter object; split it into params. */
  const handleFiltersChange = (next: EventQueryParams) => {
    const {
      level: nextLevel,
      limit: nextLimit,
      /* eslint-disable @typescript-eslint/no-unused-vars */
      offset: _offset,
      from: _from,
      to: _to,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = next;
    setLevel(nextLevel ? String(nextLevel) : "");
    const lim = Number(nextLimit);
    if (lim !== limit) setLimitParam(PAGE_SIZES.includes(lim) ? lim : 0);
    const nextChips: Chips = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && value !== "") nextChips[key] = String(value);
    }
    setChips(nextChips);
    // A new filter is a new result set: page 4 of the old one is not page 4
    // of this one.
    setOffset(0);
  };

  const handleAddFilter = useCallback(
    (field: string, value: string) => {
      setChips({ ...chips, [field]: value });
      setOffset(0);
      setEventKey("");
    },
    [chips, setChips, setOffset, setEventKey],
  );

  const goToOffset = (next: number) => {
    keepAnchorRef.current = true;
    setOffset(Math.max(0, next));
    setActiveIndex(null);
  };

  const handleNextPage = () => {
    if (pagination?.next) goToOffset(offset + limit);
  };

  const handlePrevPage = () => {
    if (pagination?.previous) goToOffset(offset - limit);
  };

  /**
   * What a saved view holds: the range AND any zoom inside it, side by side.
   * A view that kept only the zoom reopened as Oct 12 rows under a "last 1h"
   * chart with the 1h button lit.
   */
  const savableView = useMemo(
    () => ({
      range: rangeParam,
      ...(zoom ? { from: zoom.from, to: zoom.to } : {}),
      ...(level ? { level } : {}),
      ...(limitParam ? { limit: limitParam } : {}),
      ...chips,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeParam, zoomFrom, zoomTo, level, limitParam, chips],
  );

  const handleLoadView = useCallback(
    (params: Record<string, unknown>) => {
      const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
      const viewRange = str(params.range);
      const viewFrom = str(params.from);
      const viewTo = str(params.to);
      if (rangeFromParam(viewRange)) {
        setRangeParam(viewRange);
        setZoomFrom(viewFrom && viewTo ? viewFrom : "");
        setZoomTo(viewFrom && viewTo ? viewTo : "");
      } else {
        // A view saved before ranges were stored: its from/to (if any) was a
        // zoom over an unknown range. As a custom range it is at least ONE
        // window that the chart and the table both show.
        const legacy = viewFrom && viewTo ? customRange(viewFrom, viewTo) : null;
        if (legacy) setRangeParam(rangeToParam(legacy));
        setZoomFrom("");
        setZoomTo("");
      }
      setLevel(str(params.level));
      const lim = Number(params.limit);
      setLimitParam(PAGE_SIZES.includes(lim) ? lim : 0);
      const nextChips: Chips = {};
      for (const [key, value] of Object.entries(params)) {
        if (NON_CHIP_KEYS.has(key) || str(value) === "") continue;
        nextChips[key] = str(value);
      }
      setChips(nextChips);
      setOffset(0);
    },
    [setRangeParam, setZoomFrom, setZoomTo, setLevel, setLimitParam, setChips, setOffset],
  );

  // ─── The detail panel ───────────────────────────────────────────────────

  const selectedEvent = useMemo(() => {
    if (!eventKey) return null;
    if (pinned && eventKeyOf(pinned) === eventKey) return pinned;
    return events.find((e) => eventKeyOf(e) === eventKey) ?? null;
  }, [eventKey, pinned, events]);
  const selectedIndex = selectedEvent
    ? events.findIndex((e) => eventKeyOf(e) === eventKey)
    : -1;

  const openEvent = useCallback(
    (event: Event, index: number) => {
      setPinned(event);
      setActiveIndex(index);
      setEventKey(eventKeyOf(event));
    },
    [setEventKey],
  );

  const closeEvent = useCallback(() => {
    setEventKey("");
    // Back to the row the panel was showing — after j/k that is not the row
    // that opened it. A frame later, so it wins over the panel's own restore.
    const index = activeIndexRef.current;
    requestAnimationFrame(() => focusRow(index));
  }, [setEventKey]);

  // A deep link (or Back) to an event that is not on the current page: look it
  // up by what the key names, around its timestamp.
  //
  // ⚠️ ±1 SECOND, NOT ±1 ms. monitor-core before 9d3ab93 bound time bounds at
  // whole-second precision, so a millisecond window matched nothing and every
  // shared event link opened onto "wasn't found". The exact key match below
  // picks the one event out of the wider window either way.
  useEffect(() => {
    if (!eventKey || selectedEvent) return;
    const parts = parseEventKey(eventKey);
    let cancelled = false;
    const lookup = async () => {
      if (!parts) {
        setEventKey("");
        return;
      }
      const t = Date.parse(parts.timestamp);
      const res = await getEvents({
        service: parts.service,
        name: parts.name,
        from: new Date(t - 1000).toISOString(),
        to: new Date(t + 1000).toISOString(),
        limit: 100,
      });
      if (cancelled) return;
      if (!res.success) {
        toast.error(`Couldn't open the linked event: ${res.error_message || "the request failed"}`);
        setEventKey("");
        return;
      }
      const match =
        res.data.find((e) => eventKeyOf(e) === eventKey) ??
        res.data.find((e) => Date.parse(e.timestamp) === t);
      if (!match) {
        toast.error("The linked event wasn't found. Raw events are kept for 30 days.");
        setEventKey("");
        return;
      }
      setPinned(match);
    };
    void lookup();
    return () => {
      cancelled = true;
    };
  }, [eventKey, selectedEvent, setEventKey]);

  const stepEvent = useCallback(
    (delta: number) => {
      const next = selectedIndex + delta;
      if (selectedIndex < 0 || next < 0 || next >= events.length) return;
      openEvent(events[next], next);
    },
    [selectedIndex, events, openEvent],
  );

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  //   /       focus the search box
  //   j / k   next / previous event (moves the panel when it is open)
  //   Enter   open the highlighted event (a focused row's button does it natively)
  //   Esc     close the panel (the panel handles it)
  // Never while typing, and never under another dialog.

  useRegisterShortcuts("Events", EVENTS_SHORTCUTS);

  const shortcutStateRef = useRef({ events, selectedIndex, panelOpen: false, stepEvent, openEvent });
  useEffect(() => {
    activeIndexRef.current = activeIndex;
    shortcutStateRef.current = {
      events,
      selectedIndex,
      panelOpen: selectedEvent !== null,
      stepEvent,
      openEvent,
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      // A key dispatched at `document` itself has no Element target.
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        target &&
        (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]"))
      ) {
        return;
      }
      const state = shortcutStateRef.current;
      const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]').length;
      if (modals > (state.panelOpen ? 1 : 0)) return;

      if (e.key === "/" && !state.panelOpen) {
        e.preventDefault();
        document.getElementById(EVENT_SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (e.key !== "j" && e.key !== "k" && e.key !== "Enter") return;
      if (state.panelOpen) {
        if (e.key === "Enter") return;
        e.preventDefault();
        state.stepEvent(e.key === "j" ? 1 : -1);
        return;
      }
      if (state.events.length === 0) return;
      const focusedRow = target?.getAttribute(EVENT_ROW_ATTR);
      const current = focusedRow !== null && focusedRow !== undefined ? Number(focusedRow) : activeIndexRef.current;
      if (e.key === "Enter") {
        // A focused row button opens itself; this is Enter from the page body.
        if (focusedRow !== null && focusedRow !== undefined) return;
        if (current === null || !state.events[current]) return;
        e.preventDefault();
        state.openEvent(state.events[current], current);
        return;
      }
      e.preventDefault();
      const next =
        current === null
          ? 0
          : Math.min(state.events.length - 1, Math.max(0, current + (e.key === "j" ? 1 : -1)));
      setActiveIndex(next);
      focusRow(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ─── Links ──────────────────────────────────────────────────────────────

  const copyViewLink = () => {
    // The URL already IS the view; the open event is not part of it.
    const url = new URL(window.location.href);
    url.searchParams.delete("event");
    void copyText(url.toString(), { label: "Link to this view" });
  };
  const eventPermalink = useCallback(() => window.location.href, []);

  // ─── Render ─────────────────────────────────────────────────────────────

  const visibleActive = activeIndex !== null && activeIndex < events.length ? activeIndex : null;
  // Dates in the user's zone and format, like the table rows under them — a
  // UTC table under a browser-time "Oct 16, 03:00 PM – 10:00 PM" disagrees by
  // the offset.
  const absoluteWindow = zoom ?? (isCustomRange(range) ? { from: range.from, to: range.to } : null);
  const windowLabel = absoluteWindow
    ? `${formatDateTime(absoluteWindow.from, dateTimePrefs)} – ${formatDateTime(absoluteWindow.to, dateTimePrefs)}`
    : `last ${range.from}`;
  const pageNumber = Math.floor(offset / limit) + 1;
  const pageCount = pagination ? Math.max(1, Math.ceil((pagination.count ?? 0) / limit)) : null;

  return (
    <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
      <div className="space-y-4 sm:space-y-6">
        {/* Time range: presets + custom, and the chart with brush zoom */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Events</h1>
            <TimeRangePicker value={range} onChange={handleRangeChange} presets={TIME_RANGES} />
          </div>
          <EventTimeRangeChart
            from={queryWindow?.from ?? null}
            to={queryWindow?.to ?? null}
            zoomed={zoom !== null}
            filters={analyticsFilters}
            onZoom={handleZoom}
            onZoomReset={handleZoomReset}
          />
        </div>

        {/* The filter card takes the row; Saved Views and Copy link sit at its
            top-right edge instead of floating mid-page beside a half-width card. */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
          <EventFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onSearch={fetchEvents}
          />
          <div className="flex items-center gap-2 self-end lg:self-start">
            <button
              type="button"
              onClick={copyViewLink}
              title="Copy a link to this view"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
            >
              <FontAwesomeIcon icon={faLink} className="text-xs" aria-hidden />
              Copy link
            </button>
            <SavedViews
              page="events"
              currentFilters={savableView}
              onLoadView={handleLoadView}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 bg-zinc-50/50 dark:bg-zinc-800/30">
            <div className="min-w-0 text-sm text-zinc-600 dark:text-zinc-400 font-medium" aria-live="polite">
              {error ? (
                // A confident "0 events" beside a failed request is the same
                // lie in miniature, so the count is withheld rather than
                // guessed from an empty array.
                <span className="text-zinc-500 dark:text-zinc-400">
                  Events unavailable
                </span>
              ) : answeredKey !== totalKeyOf(filters, range, zoomFrom, zoomTo) ? (
                // No answer yet for THIS query (first load, or a new range or
                // filter in flight): a placeholder, never "0 events" or the
                // previous query's total. Paging and Refresh keep the key, so
                // the count stays put for those.
                <span role="status" aria-label="Loading event count" className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-44" />
                </span>
              ) : pagination ? (
                <span>
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {Math.min(events.length, limit)}
                  </span>{" "}
                  of{" "}
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {(pagination.count ?? 0).toLocaleString()}
                  </span>{" "}
                  events
                  {/* The total is for the window, so it names the window —
                      dates for a zoom or custom range, not "selected range". */}
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" "}
                    · {windowLabel}
                  </span>
                </span>
              ) : (
                <span>
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {events.length}
                  </span>{" "}
                  events
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AutoRefresh
                onRefresh={fetchEvents}
                loading={loading}
                interval={refreshSeconds}
                onIntervalChange={setRefreshSeconds}
                // Paused while an event is open: a refresh would reshuffle the
                // rows that j/k and the panel's arrows step through.
                paused={selectedEvent !== null}
              />
              <button
                onClick={fetchEvents}
                disabled={loading}
                aria-label="Refresh"
                title="Refresh"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-50 transition-colors"
              >
                <FontAwesomeIcon icon={faArrowsRotate} spin={loading} className="text-sm" />
                <span className="hidden sm:inline" aria-hidden>
                  Refresh
                </span>
              </button>
            </div>
          </div>

          {/* DOWN, NOT EMPTY. The banner used to sit above this table while
              the table rendered its own "No events found" underneath, so a
              failed query said both things at once. One branch, one fact. */}
          {error ? (
            <FailureState
              what="events"
              message={error}
              onRetry={fetchEvents}
              className="rounded-none border-0"
            />
          ) : (
            <EventTable
              events={events}
              loading={loading}
              onSelectEvent={openEvent}
              activeIndex={visibleActive}
              skeletonRows={limit}
            />
          )}

          {pagination && (pagination.next || pagination.previous) && (
            <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 bg-zinc-50/50 dark:bg-zinc-800/30">
              <button
                onClick={handlePrevPage}
                disabled={!pagination.previous || loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
              >
                <svg
                  aria-hidden
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                <span className="hidden sm:inline">Previous</span>
                <span className="sr-only sm:hidden">Previous page</span>
              </button>
              <PageJump
                // Remounted per page so the box always starts on the real page.
                key={pageNumber}
                page={pageNumber}
                pageCount={pageCount}
                disabled={loading}
                onJump={(page) => goToOffset((page - 1) * limit)}
              />
              <button
                onClick={handleNextPage}
                disabled={!pagination.next || loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
              >
                <span className="hidden sm:inline">Next</span>
                <span className="sr-only sm:hidden">Next page</span>
                <svg
                  aria-hidden
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        <p className="hidden md:block text-xs text-zinc-500 dark:text-zinc-400">
          Shortcuts: <Kbd>/</Kbd> search · <Kbd>j</Kbd> <Kbd>k</Kbd> next / previous event ·{" "}
          <Kbd>Enter</Kbd> open · <Kbd>Esc</Kbd> close
        </p>
      </div>

      {/* Event Detail Panel */}
      <EventDetailPanel
        event={selectedEvent}
        onClose={closeEvent}
        onPrev={selectedIndex > 0 ? () => stepEvent(-1) : undefined}
        onNext={
          selectedIndex >= 0 && selectedIndex < events.length - 1
            ? () => stepEvent(1)
            : undefined
        }
        onAddFilter={handleAddFilter}
        permalink={eventPermalink}
      />
    </main>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

/**
 * "Page 3 of 2,881", where the 3 is an input: type a page and press Enter.
 * The total comes from the window's count; without it the footer said "Page 1"
 * over 288,041 events.
 */
function PageJump({
  page,
  pageCount,
  disabled,
  onJump,
}: {
  page: number;
  pageCount: number | null;
  disabled: boolean;
  onJump: (page: number) => void;
}) {
  const [draft, setDraft] = useState(String(page));
  const commit = () => {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || (pageCount !== null && n > pageCount)) {
      setDraft(String(page));
      return;
    }
    if (n !== page) onJump(n);
  };
  return (
    <span className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
      <label htmlFor="events-page-jump">Page</label>
      <input
        id="events-page-jump"
        type="number"
        inputMode="numeric"
        min={1}
        max={pageCount ?? undefined}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        onBlur={commit}
        className="w-16 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-center text-base sm:text-sm text-zinc-900 [appearance:textfield] focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 [&::-webkit-inner-spin-button]:appearance-none"
      />
      {pageCount !== null && <span>of {pageCount.toLocaleString()}</span>}
    </span>
  );
}
