/**
 * Pure helpers shared by this app's OWN telemetry — the events monitor-web
 * reports about itself to Monitor's appleby zone. See AGENTS.md §6 "Monitor
 * self-telemetry".
 *
 * Dependency-free on purpose: imported by client components (through
 * `services/monitor.service.ts`), by route handlers and by instrumentation
 * (through `lib/monitor-server.ts`), and by the `/api/telemetry` relay.
 */

/** The service name every monitor-web event is filed under — browser and server alike. */
export const MONITOR_SERVICE = "monitor-web";

/** What every reported error carries about the thrown value itself. */
export interface ErrorFields {
  /** The message. monitor-core's issue fingerprint reads `error` first. */
  error: string;
  error_type?: string;
  stack?: string;
  /** Next's server-side error digest — the "Reference" shown on the error pages. */
  digest?: string;
  /** An underlying cause, e.g. undici's `ECONNREFUSED` under a bare "fetch failed". */
  cause?: string;
  /** A system error code (`ECONNREFUSED`, `ETIMEDOUT`, `ERR_NETWORK`…). */
  error_code?: string;
}

type Reportable = {
  message?: unknown;
  name?: unknown;
  stack?: unknown;
  digest?: unknown;
  code?: unknown;
  cause?: unknown;
};

const asObject = (value: unknown): Reportable =>
  (typeof value === "object" && value !== null ? value : {}) as Reportable;

/**
 * describeError turns anything thrown into the fields a cold reader needs.
 *
 * ⚠️ `fetch failed` ALONE IS UNDIAGNOSABLE. Node's fetch (undici) throws a bare
 * TypeError with that message for every transport failure and puts the real
 * reason — `ECONNREFUSED 10.0.0.5:8080`, a DNS miss, a connect timeout — on
 * `.cause`. Dropping the cause is how "monitor-core is down" and "the zone's
 * DNS record is wrong" become the same event.
 */
export function describeError(error: unknown): ErrorFields {
  const e = asObject(error);
  const cause = asObject(e.cause);
  const message =
    typeof e.message === "string" && e.message !== "" ? e.message : String(error);
  const causeMessage =
    typeof cause.message === "string" && cause.message !== "" ? cause.message : undefined;
  const code =
    typeof e.code === "string"
      ? e.code
      : typeof cause.code === "string"
        ? cause.code
        : undefined;

  return {
    error: message,
    error_type: typeof e.name === "string" ? e.name : typeof error,
    stack: typeof e.stack === "string" ? e.stack : undefined,
    digest: typeof e.digest === "string" ? e.digest : undefined,
    cause: causeMessage,
    error_code: code,
  };
}

/**
 * isTimeoutError reports whether a thrown fetch failure was a timeout rather
 * than a refusal: `AbortSignal.timeout` (TimeoutError), or undici's connect /
 * headers / body timeouts, which arrive as `cause.code` under "fetch failed".
 */
export function isTimeoutError(error: unknown): boolean {
  const { error_type, error_code } = describeError(error);
  return error_type === "TimeoutError" || /TIMEOUT|ETIMEDOUT/i.test(error_code ?? "");
}

/** The host of an upstream URL for reporting (never the path or query), or undefined if unparseable. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * A path segment that is a record id rather than a route: a UUID, a number, or a
 * long hex string (issue fingerprints, ClickHouse ids).
 */
const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{12,})$/i;

/**
 * normalisePath strips the query string and replaces id segments with `{id}`.
 *
 * ⚠️ `path` IS PART OF THE ISSUE FINGERPRINT. monitor-core groups error events
 * on project + service + name + `data.path` + the normalised message, so a raw
 * `/trailblaze/errors/9f3c…` would open one issue per issue page. Report the
 * normalised form as `path` and the raw pathname separately when it helps.
 *
 * Query strings are dropped entirely: they carry tokens, emails and search text,
 * and anything reported is retained for the life of the event store.
 */
export function normalisePath(path: string): string {
  const bare = path.split(/[?#]/)[0];
  return bare
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? "{id}" : segment))
    .join("/");
}

/** Truncates a caller-controlled string (a `?zone=` value, say) before it is reported. */
export const clip = (value: string, max = 64): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export interface Admission {
  /** How many identical events were dropped in the window before this one. */
  suppressed: number;
  /** The key table was full and this event fell into its name's shared bucket. */
  overflow: boolean;
}

/**
 * createCoalescer bounds a failure that repeats per request to one event per
 * (name, scope) per window.
 *
 * An unroutable zone is hit by every request every page makes; monitor-core
 * being down fails every proxied call at once. Reporting each one would bury
 * the single fact in hundreds of copies. The first event in a window goes out
 * immediately; the rest are counted and the count rides on the NEXT event for
 * that key as `suppressed`. If the failure stops, the last window's count is
 * never sent — it would describe a failure that has already ended.
 *
 * The key table is bounded because `scope` can be caller-controlled (a
 * `?zone=` value): past `maxKeys` live keys, new scopes share one bucket per
 * name, so a stream of made-up zones costs one event per minute, not one each.
 */
export function createCoalescer(windowMs = 60_000, maxKeys = 200) {
  const seen = new Map<string, { at: number; suppressed: number }>();

  return (name: string, scope = ""): Admission | null => {
    const now = Date.now();
    let key = `${name}|${scope}`;
    let overflow = false;

    if (!seen.has(key) && seen.size >= maxKeys) {
      for (const [k, v] of seen) {
        if (now - v.at >= windowMs) seen.delete(k);
      }
      if (seen.size >= maxKeys) {
        key = `${name}|*`;
        overflow = true;
      }
    }

    const entry = seen.get(key);
    if (entry && now - entry.at < windowMs) {
      entry.suppressed++;
      return null;
    }
    seen.set(key, { at: now, suppressed: 0 });
    return { suppressed: entry?.suppressed ?? 0, overflow };
  };
}
