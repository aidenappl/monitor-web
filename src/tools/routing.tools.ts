/**
 * Route-derived scope: which ZONE and which PROJECT the current URL is reading.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE URL SCHEME, and why the two halves are shaped differently:
 *
 *   /{zone}                         events home
 *   /{zone}/errors?project=atlas    every other zone-scoped page
 *
 * A ZONE is a PATH SEGMENT because it selects which backend answers. It has to
 * survive a bookmark and it drives the proxy's upstream choice, so it belongs in
 * the identity of the page, not in a decoration on it.
 *
 * A PROJECT is a QUERY PARAM because it is a filter inside one backend, and may
 * reasonably become multi-valued. This is Sentry's shape — org slug in the path,
 * project as a repeatable query param.
 *
 * The query param is also the ONLY mechanism that works for BOTH transports we
 * have. EventSource cannot send custom headers, so a header-based selector would
 * work for every axios call and silently leave both SSE surfaces — the live tail
 * and the desktop-alert feed — tailing the wrong project forever, with no error
 * on either side. One mechanism, not two that agree only while someone
 * remembers to keep them in step.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is PURE and dependency-free on purpose: it is imported by the
 * middleware (`src/proxy.ts`), by React components, and by the axios interceptor,
 * and the middleware runtime cannot take a dependency the others can.
 */

/** The query-string parameter monitor-core reads the project selection from. */
export const PROJECT_PARAM = "project";

/**
 * The query-string parameter the Next proxy reads the ZONE selection from.
 *
 * ⚠️ THE PROXY CONSUMES THIS AND DOES NOT FORWARD IT. Unlike `project`, which
 * monitor-core itself reads, `zone` chooses WHICH monitor-core answers — so it
 * is stripped before the upstream call. Leaving it on would hand every zone a
 * parameter it has no reason to understand.
 *
 * It is a query param for the same reason `project` is: EventSource cannot send
 * custom headers, so a header-based selector would work for every axios call and
 * silently leave both SSE surfaces streaming from the wrong ZONE — frames that
 * arrive, parse, and render, from another tenant's backend.
 *
 * It is NOT the `mon-zone` cookie. That cookie remembers where to land on bare
 * `/`; routing on it would make the upstream AMBIENT, so two tabs open on two
 * zones would share one value and each would intermittently render the other's
 * data. Per-request beats per-browser for anything that selects a backend.
 */
export const ZONE_PARAM = "zone";

/**
 * isZoneScopedPath reports whether an upstream path is served by a ZONE rather
 * than by the control plane.
 *
 * ⚠️ ONE PREDICATE, TWO SELECTORS, DELIBERATELY. The set of requests that carry
 * `?project` and the set routed to a zone are the same set by construction: a
 * project only exists inside a zone, so a request scoped to one is scoped to
 * both. Two predicates would agree only while someone remembered to edit both,
 * and the failure of that — a request routed to a zone without its project
 * selector, or vice versa — reads as the wrong data rather than as an error.
 *
 * The control plane keeps:
 *   /auth/*    sessions and identities — users are install-wide, not per-zone.
 *   /admin/*   install-wide configuration, including the registry itself.
 *   /v1/zones* the registry. Routed to a zone it would return only that zone,
 *              so the switcher could never show a second one to switch to.
 *   /health    this deployment's own liveness.
 *
 * Everything else under /v1 is a zone's own data — events, issues, analytics,
 * and (since the config tables moved to per-zone MariaDB in 119–124) api-keys,
 * alert-rules, notification-*, service-*, dashboards and views.
 *
 * ⚠️ THE DEFAULT IS ZONE-SCOPED, and that direction is chosen. A new `/v1/`
 * route added without thought routes to the zone: if that is wrong it 404s
 * loudly against a zone that does not serve it. The opposite default would send
 * a zone's data request to the control plane and answer it — with another
 * zone's data, silently. Fail toward the visible mistake.
 */
export function isZoneScopedPath(url: string): boolean {
  const path = url.split("?")[0];
  if (!path.startsWith("/v1/")) return false;
  return !path.startsWith("/v1/zones");
}

/**
 * currentZone reads the zone out of the live URL, synchronously.
 *
 * The axios interceptor has no render to be part of, exactly like
 * `currentProject` — see the note there on why scope is derived from the route
 * rather than hydrated into a store.
 *
 * Returns null on the server, where there is no location to read.
 */
export function currentZone(): string | null {
  if (typeof window === "undefined") return null;
  return zoneFromPathname(window.location.pathname);
}

/**
 * withZone appends the zone selector to a URL axios will never see.
 *
 * Same hazard as `withProject`, one level worse: a stream built without this
 * connects, delivers well-formed frames, and they are another ZONE's.
 */
export function withZone(url: string, zone: string | null): string {
  if (!zone) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${ZONE_PARAM}=${encodeURIComponent(zone)}`;
}

/**
 * Last-used zone, so bare `/` can land somewhere sensible. Written by the zone
 * switcher (next task) and read by the `/` resolver; a stale or bogus value is
 * harmless because `[zone]/layout.tsx` re-validates whatever it resolves to.
 */
export const ZONE_COOKIE = "mon-zone";

/**
 * Where `/` goes when nothing else answers — the registry is unreachable and no
 * zone cookie is set. Mirrors monitor-core's `MON_ZONE_SLUG` default so a stock
 * install lands on its real zone rather than a 404.
 *
 * Bare `/` must NEVER 404: it is what the logo links to, what login returns to,
 * and what a user types. A wrong-but-live guess sends them to a page that can
 * explain itself; no guess at all sends them nowhere.
 */
export const FALLBACK_ZONE = "trailblaze";

/**
 * First path segments that are NOT zones.
 *
 * These are the zone-agnostic surfaces: an account is not per-zone, and neither
 * is the login flow. Next.js already resolves a static segment ahead of `[zone]`,
 * so this list is not what routes them — it is what stops `zoneFromPathname`
 * reporting "settings" as a zone to code that then builds `/settings/errors`.
 */
const ZONE_AGNOSTIC_SEGMENTS = new Set([
  "login",
  "pending",
  "unauthorized",
  "settings",
  "admin",
  "api",
  "_next",
]);

/**
 * The flat page paths that existed before the zone segment, kept so old links
 * keep working.
 *
 * Every observability bookmark moved in this change — `/errors` became
 * `/{zone}/errors` — and without a shim each one resolves as a zone literally
 * named "errors" and 404s. That breaks saved links, anything in a chat log, and
 * any external system that links into the dashboard, all on the deploy.
 *
 * These names are safe to special-case FOREVER, not just during a transition:
 * monitor-core's `tools/Slug.tool.go` reserves every one of them, so no zone can
 * ever be created with a colliding slug. The shim can therefore never shadow a
 * real zone, which is what makes it a permanent redirect rather than a guess
 * with an expiry date.
 */
const LEGACY_FLAT_PAGES = new Set([
  "errors",
  "live",
  "analytics",
  "performance",
  "dashboard",
  "alerts",
  "notifications",
]);

/**
 * legacyFlatPage reports whether a pathname is a pre-zone bookmark that should
 * be redirected into a zone rather than resolved as one.
 */
export function legacyFlatPage(pathname: string): boolean {
  const segment = pathname.split("/")[1] ?? "";
  return LEGACY_FLAT_PAGES.has(segment);
}

/**
 * zoneFromPathname reads the zone out of a pathname, or null when the path is
 * zone-agnostic (or is bare `/`, which has no zone yet — that is what the `/`
 * resolver exists to answer).
 */
export function zoneFromPathname(pathname: string): string | null {
  const segment = pathname.split("/")[1] ?? "";
  if (!segment) return null;
  if (ZONE_AGNOSTIC_SEGMENTS.has(segment)) return null;
  // A dot means a file (favicon.ico, Monitor-Logo-Dark.svg), never a zone.
  if (segment.includes(".")) return null;
  return decodeURIComponent(segment);
}

/**
 * currentProject reads the live URL rather than React state.
 *
 * The scope is derived from the ROUTE, SYNCHRONOUSLY, and this is how the one
 * non-React caller — the axios request interceptor — gets at it. Hydrating scope
 * into a store from an async fetch would be the bug: every page fires its data
 * `useEffect` on mount with no ordering against that fetch, so the first render
 * would go out with the wrong scope or none at all.
 *
 * React callers use `useSearchParams` instead, so a project switch re-renders
 * them; this one has no render to be part of.
 *
 * Returns null on the server, where there is no location to read.
 */
export function currentProject(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(PROJECT_PARAM);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * withProject appends the selector to a URL that axios will never see.
 *
 * EventSource does not run through axios interceptors, so every stream URL has
 * to be built with this explicitly. That is the edit most likely to be forgotten
 * and the one with no symptom when it is: the stream connects, frames arrive,
 * and they are the wrong project's.
 */
export function withProject(url: string, project: string | null): string {
  if (!project) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${PROJECT_PARAM}=${encodeURIComponent(project)}`;
}

/**
 * zoneHref builds a link into a zone, carrying the current project selection
 * across the navigation.
 *
 * Without the carry, every click in the navbar silently resets the user to the
 * default project — the page changes, the tenant changes with it, and nothing
 * says so.
 *
 * `path` is the zone-relative tail ("" for the events home, "/errors", …).
 */
export function zoneHref(
  zone: string,
  path: string = "",
  project: string | null = null,
): string {
  return withProject(`/${zone}${path}`, project);
}

/**
 * safeNextPath narrows a `?next=` value to a same-origin path, or null.
 *
 * The deep link round-trips through an attacker-supplied query string, so this
 * is the open-redirect guard: only a single leading slash, never `//host` or
 * `/\host` (which browsers read as protocol-relative), never an absolute URL.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/** The parameter the pre-login destination round-trips through. */
export const NEXT_PARAM = "next";

/**
 * nextParamFor returns the value to round-trip, or null when there is nothing
 * worth preserving.
 *
 * Bare `/` is nothing — it is where login already lands. `/login` itself is
 * worse than nothing: `next=/login` loops.
 */
export function nextParamFor(from?: string | null): string | null {
  const target = safeNextPath(from);
  if (!target || target === "/" || target.startsWith("/login")) return null;
  return target;
}

/**
 * loginHref builds the login URL that remembers where the user was going.
 *
 * The previous behaviour cloned the request URL, overwrote the pathname with
 * `/login` and blanked the search — so a pasted deep link into a specific issue
 * was simply destroyed by the session check, and the user landed on the events
 * home with no clue what they had lost. Round-tripping it through `next` costs
 * one parameter and returns them to the page they asked for.
 *
 * The zone and the project selector both live in that string, so losing it loses
 * the scope as well as the page.
 */
export function loginHref(from?: string | null): string {
  const target = nextParamFor(from);
  if (!target) return "/login";
  return `/login?${NEXT_PARAM}=${encodeURIComponent(target)}`;
}
