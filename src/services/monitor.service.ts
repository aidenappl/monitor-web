import { Monitor } from "@aidenappleby/monitor-js";
import axios, { type AxiosError, type AxiosInstance } from "axios";
import { currentProject, currentZone, PROJECT_PARAM, ZONE_PARAM } from "@/tools/routing.tools";
import {
  MONITOR_SERVICE,
  createCoalescer,
  describeError,
  normalisePath,
} from "@/tools/telemetry.tools";

/**
 * BROWSER telemetry — monitor-web reporting its OWN failures to Monitor's
 * appleby zone. See AGENTS.md §6 "Monitor self-telemetry" for the policy and
 * the event catalogue; the short version is errors and warnings only, never a
 * pageview, a navigation or a success.
 *
 * Events post to this app's own `/api/telemetry` relay, which adds the ingest
 * key server-side: a key compiled into the bundle is readable by anyone who
 * loads the page. `apiKey` is therefore empty here. When the server has no
 * MON_TELEMETRY_* configured the relay answers 204 and the events are dropped.
 *
 * null during server rendering — server code uses `lib/monitor-server.ts`.
 */
export const monitor: Monitor | null =
  typeof window !== "undefined"
    ? new Monitor({
        service: MONITOR_SERVICE,
        ingestUrl: "/api/telemetry",
        apiKey: "",
        env: process.env.NODE_ENV === "production" ? "production" : "development",
        ignoreErrors: [
          // Thrown by browser extensions, not by this app.
          /(chrome|moz|safari(-web)?)-extension:\/\//,
          // A benign layout notification some browsers surface as an error.
          /ResizeObserver loop/,
        ],
      })
    : null;

/**
 * A catch inside a poll loop (the 10s health pill, auto-refreshing widgets)
 * would otherwise report the same throw every tick. One event per name+message
 * per minute; the rest ride on the next one as `suppressed`.
 */
const coalesce = createCoalescer();

/**
 * Where the browser is when something fails. `path` is id-normalised because
 * monitor-core fingerprints issues on it; `page` keeps the raw pathname for
 * reproduction. Never the query string.
 */
const scopeFields = (): Record<string, unknown> => ({
  zone: currentZone() ?? undefined,
  project: currentProject() ?? undefined,
  path: normalisePath(window.location.pathname),
  page: window.location.pathname,
});

/**
 * reportError reports a thrown value that the app caught and handled — an error
 * boundary, or a `catch` that would otherwise only set state or toast.
 *
 * `data` should say what was being attempted and name the records involved
 * (ids go in `data`, never in `name`). Never pass a request/response body, a
 * form value, a key or a channel config.
 */
export const reportError = (
  name: string,
  error: unknown,
  data: Record<string, unknown> = {},
): void => {
  if (!monitor) return;
  const fields = describeError(error);
  const admitted = coalesce(name, fields.error.slice(0, 200));
  if (!admitted) return;
  monitor.error(name, {
    data: {
      ...scopeFields(),
      ...data,
      ...fields,
      suppressed: admitted.suppressed || undefined,
    },
  });
};

/** reportWarn reports a handled, degraded condition that threw nothing. */
export const reportWarn = (name: string, data: Record<string, unknown> = {}): void => {
  if (!monitor) return;
  const admitted = coalesce(name);
  if (!admitted) return;
  monitor.warn(name, {
    data: { ...scopeFields(), ...data, suppressed: admitted.suppressed || undefined },
  });
};

/** Request start times, for `duration_ms`. Keyed by the config object axios hands back on the error. */
const started = new WeakMap<object, number>();

/**
 * attachMonitor hooks the ONE axios client (`api.service.ts`) and reports
 * TRANSPORT failures only — never a status code.
 *
 * ⚠️ WHY NOT STATUS CODES. Every status the browser can see came either from
 * monitor-core, which already emitted an `http.request.end` event for that exact
 * request at the right level, or from this app's own proxy, which reports its
 * own refusals and upstream failures server-side (`proxy.zone.unroutable`,
 * `proxy.upstream.failed`). A client event per 4xx/5xx would duplicate one or
 * the other for every failed call. This is `attachAxiosMonitor(…, { minStatus:
 * 600, ignorePaths: ["/health"] })` written out, so the event can carry the zone
 * — which lives in `config.params`, where the SDK's hook cannot see it — and the
 * consequence.
 *
 * Because the client sets `validateStatus: () => true`, axios only rejects on a
 * transport failure, a timeout or a cancellation, so an `onRejected` handler
 * sees exactly the set worth reporting.
 *
 * `/health` is skipped: the navbar pill polls it every 10s and its own state
 * already renders that failure.
 */
export const attachMonitor = (instance: AxiosInstance): void => {
  if (!monitor) return;

  instance.interceptors.request.use((config) => {
    started.set(config, Date.now());
    return config;
  });

  instance.interceptors.response.use(undefined, (err: unknown) => {
    reportTransportFailure(err);
    return Promise.reject(err);
  });
};

function reportTransportFailure(err: unknown): void {
  if (!monitor) return;
  // A cancellation is a caller's decision, not a failure.
  if (axios.isCancel(err)) return;

  const e = err as Partial<AxiosError>;
  // "Request aborted": the browser tore the request down (navigation, unload).
  if (e.code === "ECONNABORTED" && /aborted/i.test(e.message ?? "")) return;
  // The user's own connectivity is not a monitor-web failure, and the event
  // could not be delivered until they are back anyway.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const config = e.config;
  const url = (config?.url ?? "").split(/[?#]/)[0];
  if (url === "/health") return;

  const path = normalisePath(`/api/monitor${url}`);
  const method = (config?.method ?? "get").toUpperCase();
  const admitted = coalesce("api.request.network_error", `${method} ${path}`);
  if (!admitted) return;

  const params = (config?.params ?? {}) as Record<string, unknown>;
  const start = config ? started.get(config) : undefined;
  const timedOut = e.code === "ECONNABORTED" || e.code === "ETIMEDOUT";

  monitor.error("api.request.network_error", {
    data: {
      ...describeError(err),
      method,
      path,
      url: `/api/monitor${url}`,
      zone: typeof params[ZONE_PARAM] === "string" ? params[ZONE_PARAM] : undefined,
      project: typeof params[PROJECT_PARAM] === "string" ? params[PROJECT_PARAM] : undefined,
      page: window.location.pathname,
      timed_out: timedOut,
      timeout_ms: config?.timeout,
      duration_ms: start !== undefined ? Date.now() - start : undefined,
      reason: timedOut
        ? "no response from this app's proxy within the client timeout"
        : "no response from this app's proxy (server unreachable or connection reset)",
      outcome: "fetchApi returned a network_error result; the calling page renders its failure state",
      suppressed: admitted.suppressed || undefined,
    },
  });
}
