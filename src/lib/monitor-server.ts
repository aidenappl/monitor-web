import { Monitor } from "@aidenappleby/monitor-js";
import type { Instrumentation } from "next";
import { ZONE_PARAM, zoneFromPathname } from "@/tools/routing.tools";
import {
  MONITOR_SERVICE,
  clip,
  createCoalescer,
  describeError,
  normalisePath,
} from "@/tools/telemetry.tools";

/**
 * SERVER-SIDE telemetry: instrumentation, route handlers and server components
 * reporting to Monitor's appleby zone directly, with the server-held key.
 *
 * ⚠️ MON_TELEMETRY_*, NOT MONITOR_*. The Lattice stack that runs this container
 * carries a stack-level `MONITOR_API_KEY` holding the TRAILBLAZE zone's ingest
 * master key, and monitor-core reads `MONITOR_API_KEY` for exactly that. A
 * same-named variable here would silently send this app's telemetry into the
 * wrong zone with the wrong credential. See AGENTS.md §6.
 *
 * Unset URL or key → every helper here is a no-op and the app runs normally.
 *
 * Never report cookies, headers, request bodies or query strings.
 */

let instance: Monitor | null | undefined;

// Created on first use, from plain env (these are deliberately NOT in Keyring:
// a Keyring failure must itself be reportable). The SDK must not install its
// own process-wide handlers here — an uncaughtException listener changes how
// Node exits on a crash, and Next owns that.
const getMonitor = (): Monitor | null => {
  if (instance !== undefined) return instance;
  const ingestUrl = process.env.MON_TELEMETRY_INGEST_URL;
  const apiKey = process.env.MON_TELEMETRY_API_KEY;
  instance =
    ingestUrl && apiKey
      ? new Monitor({
          service: MONITOR_SERVICE,
          ingestUrl,
          apiKey,
          env: process.env.MON_TELEMETRY_ENV || "production",
          captureErrors: false,
          captureUnhandledRejections: false,
        })
      : null;
  return instance;
};

/**
 * One event per name+zone per minute. A zone that cannot be routed is hit by
 * every request on every page load; monitor-core being down fails every proxied
 * call at once. The count of what was dropped rides on the next event.
 */
const coalesce = createCoalescer();

/** Fields for a server event. `zone` (when there is one) is the coalescing scope. */
export type ServerEventData = { zone?: string | null } & Record<string, unknown>;

const emit = (
  level: "error" | "warn",
  name: string,
  data: ServerEventData,
  error?: unknown,
): void => {
  const m = getMonitor();
  if (!m) return;
  const zone = typeof data.zone === "string" ? clip(data.zone) : undefined;
  const admitted = coalesce(name, zone ?? "");
  if (!admitted) return;
  m.emit(name, level, {
    data: {
      ...data,
      zone,
      ...(error !== undefined ? describeError(error) : {}),
      suppressed: admitted.suppressed || undefined,
      coalesce_overflow: admitted.overflow || undefined,
    },
  });
};

/** serverError reports a thrown value a route handler or server component caught. Coalesced. */
export const serverError = (name: string, error: unknown, data: ServerEventData = {}): void =>
  emit("error", name, data, error);

/** serverWarn reports a handled, degraded condition. Coalesced. */
export const serverWarn = (name: string, data: ServerEventData = {}): void =>
  emit("warn", name, data);

type OnRequestErrorArgs = Parameters<Instrumentation.onRequestError>;

/**
 * reportServerError — Next's `onRequestError` hook: an exception nothing caught,
 * in rendering, a route handler or a server action.
 *
 * NOT coalesced: each one carries the digest the user sees as "Reference" on the
 * error page, and dropping one would make that reference unfindable.
 */
export const reportServerError = (
  error: OnRequestErrorArgs[0],
  request: OnRequestErrorArgs[1],
  context: OnRequestErrorArgs[2],
): void => {
  const m = getMonitor();
  if (!m) return;
  const [pathname, query = ""] = request.path.split("?");
  let zone: string | null = null;
  try {
    zone = zoneFromPathname(pathname) ?? new URLSearchParams(query.split("#")[0]).get(ZONE_PARAM);
  } catch {
    // A malformed %-escape in the path (decodeURIComponent throws). The zone is
    // then unknowable; the error itself is what matters, so report without it.
  }
  m.error("server.request.error", {
    data: {
      ...describeError(error),
      method: request.method,
      path: normalisePath(pathname),
      page: pathname,
      zone: zone ? clip(zone) : undefined,
      route: context.routePath,
      route_type: context.routeType,
      router_kind: context.routerKind,
      render_source: context.renderSource,
      outcome: "Next answered with its error response (500 / nearest error boundary)",
    },
  });
};
