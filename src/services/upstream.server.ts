import { routesToZone, ZONE_PARAM } from "@/tools/routing.tools";
import { zoneQueryURL } from "@/services/registry.server";
import { serverWarn } from "@/lib/monitor-server";
import { normalisePath } from "@/tools/telemetry.tools";

/**
 * SERVER-ONLY: which monitor-core answers a given proxied request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS.
 *
 * The zone has always been a path segment because it "selects which backend
 * answers" — that is what `[zone]/layout.tsx` and `tools/routing.tools.ts` both
 * say. It did not. Every proxy route resolved its upstream ONCE, at module load,
 * from MONITOR_API_INTERNAL_URL, so `/appleby/errors` and `/trailblaze/errors`
 * fetched from the identical backend and rendered identical data under two
 * different names. With one zone that was invisible. The second zone turned an
 * unimplemented feature into confidently wrong data, which is worse than an
 * outage: an outage tells you.
 *
 * All three bridges (the JSON proxy and the two SSE routes) now resolve through
 * here, so the rule lives once instead of in four copies that agreed only while
 * someone remembered to edit all four.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The control plane: this deployment's own monitor-core, over the container
 * network so the request never hairpins out to the public domain.
 *
 * Serves everything that is not a zone's own data — /auth, /admin, the registry
 * — and, per LOCAL_ZONE below, that one zone's data too.
 */
const CONTROL_PLANE = (
  process.env.MONITOR_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_MONITOR_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

/**
 * The zone this deployment's own monitor-core ALSO serves, when it runs
 * MON_ROLE=both — which the control plane does today (MON_ZONE_SLUG=trailblaze).
 *
 * Requests for it take CONTROL_PLANE rather than its registered `query_url`, for
 * two reasons. It keeps the hop on the container network instead of leaving the
 * building and coming back through the public edge — the same argument that put
 * MONITOR_API_INTERNAL_URL there in the first place. And it means the local zone
 * keeps working when its registry row has no `query_url` recorded, which is
 * exactly the state trailblaze's row is in: it predates the endpoint columns,
 * and migration 125 deliberately declined to invent a value for it.
 *
 * Defaults to FALLBACK_ZONE's value rather than being required, so an existing
 * deployment keeps working with no env change. Set MON_LOCAL_ZONE explicitly on
 * a control plane whose own zone is named something else, or to "" on a pure
 * MON_ROLE=app control plane that serves no zone data at all.
 */
const LOCAL_ZONE = (process.env.MON_LOCAL_ZONE ?? "trailblaze").trim();

/**
 * Why a request was refused. `unauthenticated` is the session, not the zone:
 * the registry lookup itself was refused, and the status is passed through so
 * the browser's 401-refresh (or 403 role routing) runs.
 */
export type UpstreamRefusal = "zone_unroutable" | "unauthenticated";

/** Where a proxied request should go, or the refusal to send it anywhere. */
export type Upstream =
  | { ok: true; base: string }
  | {
      ok: false;
      status: number;
      error: string;
      reason: UpstreamRefusal;
      /** monitor-core's error_code, when the refusal is its own (4003/4004). */
      code: number | null;
    };

/**
 * resolveUpstream picks the origin for one proxied request.
 *
 * `path` is the upstream path WITHOUT the /api/monitor prefix ("/v1/analytics").
 * `zone` is the caller's `?zone=` selection, or null when absent.
 * `method` is only reported — it names what was refused and never changes the
 * answer.
 *
 * ⚠️ AN UNRESOLVABLE ZONE IS A REFUSAL, NEVER A FALLBACK. Quietly serving
 * CONTROL_PLANE when a zone cannot be resolved would reintroduce the original
 * bug at exactly the moment it is hardest to notice — a zone that is registered,
 * reachable in the UI, and answering with another zone's rows. A 502 naming the
 * zone is recoverable; wrong data is not, because nobody goes looking.
 */
export async function resolveUpstream(
  path: string,
  zone: string | null,
  method = "GET",
): Promise<Upstream> {
  // Not answered by a zone: /auth, /admin, the registry. These are the control
  // plane's by definition.
  //
  // ⚠️ `/health` USED TO BE ON THAT LIST AND WAS WRONG THERE. The predicate was
  // `isZoneScopedPath`, which is false for anything outside /v1/, so a zone's
  // liveness probe was answered by the control plane — and the navbar pill on
  // every page of every zone reported the control plane's health under that
  // zone's name. A down zone rendered a green "Online". `routesToZone` adds the
  // probe paths back; see its note for why routing and tenancy are now two
  // predicates rather than one.
  if (!routesToZone(path)) return { ok: true, base: CONTROL_PLANE };

  // No selection. Only reachable from a page outside /{zone}/… or a hand-made
  // request; the control plane is the honest answer for a caller that named no
  // zone, and it is what every such request already got before this change.
  if (!zone) return { ok: true, base: CONTROL_PLANE };

  if (LOCAL_ZONE !== "" && zone === LOCAL_ZONE) {
    return { ok: true, base: CONTROL_PLANE };
  }

  const resolved = await zoneQueryURL(zone);

  // ⚠️ AN EXPIRED SESSION IS NOT AN UNROUTABLE ZONE. The registry read carries
  // the caller's cookies, so a lapsed access token makes it 401 — and reporting
  // that as a 502 hid it from the client's refresh, breaking every non-local
  // zone ~15 minutes after each refresh. Pass the session's refusal through.
  if (!resolved.ok && (resolved.status === 401 || resolved.status === 403)) {
    return {
      ok: false,
      status: resolved.status,
      reason: "unauthenticated",
      code: resolved.code,
      error:
        resolved.status === 401
          ? "Your session has expired. Sign in again to reach this zone."
          : "The zone registry refused this session.",
    };
  }

  const base = resolved.ok ? resolved.url : null;
  if (!base) {
    // Reported HERE, once, for all three bridges — and coalesced per zone per
    // minute, because an unroutable zone is refused on every request of every
    // page load and one event with a `suppressed` count says the same thing as
    // hundreds. `registry_status` separates "the row has no URL" (the registry
    // read succeeded) from "the registry could not be read, and with what
    // status" — the fixes differ completely. A 401/403 never reaches here: it
    // is passed through above as the session refusal it is.
    serverWarn("proxy.zone.unroutable", {
      zone,
      method,
      path: normalisePath(path),
      reason: "zone_unroutable",
      registry_status: resolved.ok ? null : resolved.status,
      registry_read: resolved.ok ? "unknown_zone_or_no_query_url" : "registry_unreadable",
      outcome: "returned 502 zone_unroutable",
    });
    return {
      ok: false,
      status: 502,
      reason: "zone_unroutable",
      code: null,
      error:
        `No query endpoint for zone "${zone}". The zone is not in the registry, ` +
        `has no query_url recorded, or the registry could not be read. ` +
        `Set its URLs in Admin → Registry; this request was refused rather ` +
        `than answered from another zone.`,
    };
  }
  return { ok: true, base };
}

/**
 * zoneFromRequest reads and REMOVES the zone selector from a request's query
 * string, returning the slug and the search string to forward on.
 *
 * The parameter is consumed here, not proxied: it names which monitor-core to
 * ask, which is a fact about this hop and means nothing to the box that answers.
 */
export function zoneFromRequest(url: URL): {
  zone: string | null;
  search: string;
} {
  const params = new URLSearchParams(url.search);
  const raw = params.get(ZONE_PARAM);
  params.delete(ZONE_PARAM);

  const query = params.toString();
  const zone = raw?.trim();
  return { zone: zone ? zone : null, search: query ? `?${query}` : "" };
}
