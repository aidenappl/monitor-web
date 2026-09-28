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
 * The liveness probes a ZONE answers for itself, outside the /v1/ namespace.
 *
 * ⚠️ THE ONE PLACE THE TWO SELECTORS MUST DISAGREE, and it took a wrong answer
 * in the navbar of every page to notice. `/health` does not start with `/v1/`,
 * so `isZoneScopedPath` reported false, so `resolveUpstream` sent it to the
 * CONTROL PLANE — and `HealthStatus` polled it every ten seconds and rendered a
 * green "Online" with the control plane's queue depth in the navbar of a zone
 * that could be completely down. Not a missing status: a confidently wrong one,
 * on the one widget whose entire job is to say whether the thing you are looking
 * at is up.
 *
 * It is a SEPARATE set rather than a widening of `isZoneScopedPath` because only
 * the ROUTING half of that predicate applies here. A probe is answered by a zone
 * but has no tenant dimension inside it — `/health?project=atlas` is a parameter
 * monitor-core's health handler has no reason to understand, and sending it
 * would be the same class of mistake as putting `?project` on `/auth/refresh`.
 * See `routesToZone` for how the two are recombined.
 */
export const ZONE_PROBE_PATHS = new Set(["/health", "/ready"]);

/**
 * isZoneProbePath reports whether a path is a per-zone liveness probe.
 *
 * Exact matches only. A prefix test would swallow anything that later hangs off
 * these names (`/health/deep`, `/ready//…`) and route it to a zone silently,
 * which is precisely the "answered by the wrong box" failure this whole file
 * exists to make impossible.
 */
export function isZoneProbePath(url: string): boolean {
  return ZONE_PROBE_PATHS.has(url.split("?")[0]);
}

/**
 * routesToZone reports whether a request is ANSWERED BY a zone.
 *
 * ⚠️ THIS IS THE ROUTING PREDICATE. `isZoneScopedPath` is now only the TENANCY
 * one — "does this request carry `?project`" — and the two are no longer the
 * same set. The difference is exactly `ZONE_PROBE_PATHS`: a zone answers for its
 * own liveness, and that answer has no project inside it.
 *
 * Use this in `resolveUpstream` and for the `?zone` selector. Use
 * `isZoneScopedPath` for the `?project` selector. Getting them backwards sends a
 * project parameter to a health handler (harmless but wrong) or, far worse,
 * sends a zone's data request to the control plane and has it answered — with
 * another zone's rows, silently.
 */
export function routesToZone(url: string): boolean {
  return isZoneScopedPath(url) || isZoneProbePath(url);
}

/**
 * The scope the CURRENTLY MOUNTED React tree was rendered under.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY A MODULE-LEVEL MIRROR OF SOMETHING THAT IS ALREADY IN THE URL.
 *
 * `window.location` updates the instant the router navigates. React commits the
 * new tree some time after that. In the gap, the OLD components are still
 * mounted and still able to fire a request — and an interceptor reading
 * `window.location` hands that request the NEW project. The result is a page
 * showing one tenant's issues, one tenant's counts and another tenant's
 * services, with every request 200 and nothing in an error state.
 *
 * Publishing the scope from `ScopeBoundary`'s RENDER (not an effect — see the
 * note there on ordering) means the value flips at the same moment the tree that
 * reads it does. A request fired by a component that is about to unmount goes
 * out with the scope that component was rendered under, and its answer is
 * discarded by the `cancelled` flag it already has. Coherent, then gone — rather
 * than incoherent and on screen.
 *
 * The pathname stamp is what stops the mirror going stale. Without it, walking
 * from `/trailblaze/errors?project=atlas` to `/settings` would leave the last
 * zone-scoped selection published, and the account-level page would silently
 * send `?zone=trailblaze&project=atlas` on requests that have no tenant at all.
 * A stamp that no longer matches the live path means "this is not about the page
 * you are on", and the readers fall back to the URL.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface PublishedScope {
  zone: string | null;
  project: string | null;
  /** The pathname this scope describes. Read back as a staleness check. */
  pathname: string;
}

let publishedScope: PublishedScope | null = null;

/**
 * publishScope records the scope of the tree being rendered.
 *
 * ⚠️ A NO-OP ON THE SERVER, DELIBERATELY. Client components render on the server
 * too, and this module instance is shared by every concurrent request there — so
 * writing to it during SSR would leak one user's zone and project into another
 * user's render. There is no `window.location` on the server either, so the
 * readers below already return null; nothing is lost by declining to write.
 */
export function publishScope(scope: PublishedScope): void {
  if (typeof window === "undefined") return;
  publishedScope = scope;
}

/**
 * readScope returns the published scope, or null when there is none that
 * describes the page currently on screen.
 */
export function readScope(): PublishedScope | null {
  if (typeof window === "undefined") return null;
  if (!publishedScope) return null;
  if (publishedScope.pathname !== window.location.pathname) return null;
  return publishedScope;
}

/**
 * currentZone reads the zone the mounted tree is rendering, falling back to the
 * live URL.
 *
 * The axios interceptor has no render to be part of, exactly like
 * `currentProject` — see the note there on why scope is derived from the route
 * rather than hydrated into a store.
 *
 * Returns null on the server, where there is no location to read.
 */
export function currentZone(): string | null {
  if (typeof window === "undefined") return null;
  const published = readScope();
  if (published) return published.zone;
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
 * currentProject reads the scope the mounted tree is rendering, falling back to
 * the live URL.
 *
 * The scope is derived from the ROUTE, SYNCHRONOUSLY, and this is how the one
 * non-React caller — the axios request interceptor — gets at it. Hydrating scope
 * into a store from an async fetch would be the bug: every page fires its data
 * `useEffect` on mount with no ordering against that fetch, so the first render
 * would go out with the wrong scope or none at all.
 *
 * React callers use `useScope()` instead, so a project switch remounts them;
 * this one has no render to be part of. The published mirror is what keeps the
 * two answers the same during the frames between a navigation and its commit —
 * see `PublishedScope` for the half-page failure that costs.
 *
 * Returns null on the server, where there is no location to read.
 */
export function currentProject(): string | null {
  if (typeof window === "undefined") return null;
  const published = readScope();
  if (published) return published.project;
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
 * scopeKeyOf builds the identity of a scope.
 *
 * Exported so nothing has to re-derive the format. The dashboard's autosave
 * guard compares the scope an edit was made under against the scope live at the
 * moment the debounce fires, and a second, subtly different formula there — one
 * that folded `null` and `""` together, say — would compare equal across a
 * change that matters and write into the wrong tenant. One definition.
 *
 * It lives here rather than in `ScopeBoundary` because the suggestion cache in
 * `services/api.ts` keys on it too, and a service module has no business
 * importing a React component to get a string formula.
 */
export function scopeKeyOf(zone: string | null, project: string | null): string {
  return `${zone ?? ""}::${project ?? "__default__"}`;
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
