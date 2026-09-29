import { cookies } from "next/headers";
import { cache } from "react";
import type { Zone } from "@/types";
import { serverError } from "@/lib/monitor-server";
import { hostOf, isTimeoutError } from "@/tools/telemetry.tools";

/**
 * SERVER-ONLY reads of the tenancy registry.
 *
 * ⚠️ This is not a second HTTP client. `services/api.service.ts` is the one
 * browser transport and stays that way; this file runs where that client cannot
 * — inside a Server Component, before any of it reaches the browser — and it is
 * the same shape as the proxy route handlers next door: forward the caller's own
 * cookies to monitor-core, read the envelope, hand back a value.
 *
 * It exists because zone validation has to happen on the SERVER. A client-side
 * check renders the page first and corrects it afterwards, which means a bad
 * zone flashes a real dashboard before the 404 — and every data effect on that
 * page has already fired against it.
 */

// Same upstream rule as app/api/monitor/[...path]/route.ts and the two SSE
// bridges: prefer the container-network address so the request never hairpins
// out to the public domain. Read at runtime, server-only, never bundled.
// ⚠️ Four copies of this now exist — keep them in step.
const UPSTREAM = (
  process.env.MONITOR_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_MONITOR_API_URL ||
  "http://localhost:8080"
).replace(/\/+$/, "");

/** Why the registry gave no list. */
type RegistryRefusal = {
  ok: false;
  // 0 = no HTTP answer at all (network, DNS, restart, timeout). `code` is the
  // envelope's error_code when monitor-core sent one (4003/4004 on a 403).
  status: number;
  code: number | null;
};

/** One read of `/v1/zones`: the list, or why there is none. */
type RegistryRead = { ok: true; zones: Zone[] } | RegistryRefusal;

/** A zone lookup for routing: its origin (null = unknown or no query_url), or a refusal. */
export type ZoneLookup = { ok: true; url: string | null } | RegistryRefusal;

/** The session cookie a lookup must carry before the snapshot will answer it. */
const ACCESS_COOKIE = "mon-access-token";

/** Bounded so one hung read can't stall every deduped request behind it. */
const REGISTRY_TIMEOUT_MS = 5_000;

/**
 * How long a successful registry read is trusted FOR ROUTING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WITHOUT THIS, EVERY PROXIED ZONE REQUEST COST A REGISTRY READ, AND AN
 * EXPIRED ACCESS TOKEN BROKE THE ZONE INSTEAD OF REFRESHING IT.
 *
 * `cache()` below only dedupes inside a React server render; in the proxy route
 * handlers it does nothing. So one appleby page load made ~20 `/v1/zones` calls
 * to the control plane in three seconds, and the navbar health poll made one
 * every ten. Worse, each of those carried the caller's cookies — so once the
 * 15-minute access token lapsed, the lookup 401'd, the zone "could not be
 * resolved", and the browser got a 502 it has no reason to refresh on. Every
 * page of every non-local zone went dark until the user happened to navigate.
 *
 * The registry is install-wide configuration: `/v1/zones` answers every
 * authenticated session with the same rows (no role or project filter, and the
 * read sends only the Cookie header). So a successful read is shared within this
 * process and used ONLY to pick an origin — it never reaches a response.
 * monitor-web runs as one replica; a second replica keeps its own copy.
 *
 * ⚠️ The snapshot answers only a caller that carries an access-token cookie.
 * Without that gate, a logged-out caller could tell a registered zone from an
 * unknown one by the status code — the enumeration `[zone]/layout.tsx` refuses
 * to allow. The browser drops the cookie when the 15-minute token lapses, so an
 * expired session gets a 401 straight from here and refreshes.
 *
 * The costs:
 *   - Staleness. A registry edit (new query_url, retired zone) takes up to this
 *     long to reach routing. A slug missing from a fresh snapshot, or cached
 *     with no query_url, falls through to a live read, so a newly registered or
 *     newly configured zone is not delayed.
 *   - Revocation. A warm snapshot means a proxied zone request no longer passes
 *     through the control plane, so a disabled or SSO-revoked user can keep
 *     reading zone data until their access token expires (≤15 minutes). That
 *     window already existed at the zone itself (see monitor-core's
 *     validateSessionToken); the proxy just no longer closes it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ROUTING_TTL_MS = 30_000;
let routingSnapshot: { zones: Zone[]; at: number } | null = null;

/** In-flight reads keyed by cookie header, so a page load's burst is one call. */
const inflightReads = new Map<string, Promise<RegistryRead>>();

const REGISTRY_OUTCOME =
  "registry treated as unreadable: zone pages fail open (no 404), and the proxy " +
  "refuses every non-local zone with 502 zone_unroutable";

/**
 * readRegistry performs one `/v1/zones` read, deduped per cookie header.
 *
 * TELEMETRY: it reports what monitor-core CANNOT see from its side — the request
 * never arriving (a thrown fetch) or a 2xx in the wrong shape. A non-2xx is NOT
 * reported here: monitor-core received that request and emitted its own
 * `http.request.end` for it, at the right level. A 401 in particular is a
 * routine expired session, which the caller passes through so the browser
 * refreshes.
 */
function readRegistry(cookieHeader: string): Promise<RegistryRead> {
  const pending = inflightReads.get(cookieHeader);
  if (pending) return pending;

  const read = (async (): Promise<RegistryRead> => {
    const startedAt = Date.now();
    try {
      const res = await fetch(`${UPSTREAM}/v1/zones`, {
        headers: { Accept: "application/json", Cookie: cookieHeader },
        cache: "no-store",
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => null);
      const envelope = (body ?? {}) as { data?: unknown; error_code?: unknown };
      if (!res.ok) {
        const code = typeof envelope.error_code === "number" ? envelope.error_code : null;
        return { ok: false, status: res.status, code };
      }
      if (!Array.isArray(envelope.data)) {
        // A contract change: monitor-core answered 200, so nothing on its side
        // records that this app could not read the answer.
        serverError(
          "registry.read.malformed",
          new Error("GET /v1/zones answered 2xx without a data array"),
          {
            method: "GET",
            path: "/v1/zones",
            upstream_host: hostOf(UPSTREAM),
            status: res.status,
            // Top-level key NAMES only — never values.
            body_keys:
              body && typeof body === "object"
                ? Object.keys(body).slice(0, 10).join(",")
                : typeof body,
            reason: "the registry response is not the { data: Zone[] } envelope",
            outcome: REGISTRY_OUTCOME,
          },
        );
        return { ok: false, status: 502, code: null };
      }

      const zones = envelope.data as Zone[];
      // A slow read must not overwrite a newer one that finished first.
      if (!routingSnapshot || routingSnapshot.at < startedAt) {
        routingSnapshot = { zones, at: startedAt };
      }
      return { ok: true, zones };
    } catch (err) {
      serverError("registry.read.failed", err, {
        method: "GET",
        path: "/v1/zones",
        upstream_host: hostOf(UPSTREAM),
        duration_ms: Date.now() - startedAt,
        timed_out: isTimeoutError(err),
        reason: "the registry read threw (control plane unreachable, or a non-JSON body)",
        outcome: REGISTRY_OUTCOME,
      });
      return { ok: false, status: 0, code: null };
    }
  })().finally(() => inflightReads.delete(cookieHeader));

  inflightReads.set(cookieHeader, read);
  return read;
}

/**
 * listZones returns the install's active zones, or null when the registry could
 * not be read at all.
 *
 * ⚠️ NULL AND [] MEAN DIFFERENT THINGS, and conflating them is the bug to avoid.
 * `[]` is a definitive answer — this install has no zones. `null` is "no answer":
 * the session expired mid-flight, monitor-core is restarting, DNS blipped.
 * Callers must not treat `null` as grounds to 404, or an unrelated outage starts
 * telling users their bookmarks are wrong.
 *
 * `cache()` dedupes within one request — the layout and the `/` resolver ask the
 * same question. It always reads live (the page must reflect the registry as it
 * is); a success also refreshes the routing snapshot above.
 */
export const listZones = cache(async (): Promise<Zone[] | null> => {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;

  const read = await readRegistry(cookieHeader);
  return read.ok ? read.zones : null;
});

/**
 * isKnownZone answers whether a slug names a zone this install has.
 *
 * ⚠️ FAILS OPEN, on purpose. It reports true when the registry could not be
 * read, because the alternative is an outage that presents as "your zone does
 * not exist" on every page at once. A user cannot tell those apart, and the
 * wrong one sends them hunting for a URL that was never broken. A request that
 * gets past here on a failed lookup still has to survive monitor-core's own
 * validation on the very next call, so nothing is actually granted by guessing
 * yes — only a 404 is avoided.
 *
 * It fails CLOSED on a definitive answer: a slug absent from a list we really
 * did read is a 404.
 */
export async function isKnownZone(slug: string): Promise<boolean> {
  const zones = await listZones();
  if (zones === null) return true;
  return zones.some((zone) => zone.slug === slug);
}

/**
 * zoneQueryURL resolves a zone slug to the origin that answers its reads — or
 * says WHY it cannot, so the refusal that follows can be diagnosed.
 *
 * ⚠️ THE SLUG IS THE ONLY THING THE CLIENT SUPPLIES. The URL is looked up here,
 * in the registry, and never accepted from the request — otherwise `?zone=` on
 * the proxy would be an open SSRF: a caller could name any origin and have the
 * server fetch it with the session's cookies attached.
 *
 * ⚠️ FAILS CLOSED, unlike `isKnownZone` directly above, and the asymmetry is
 * deliberate. `isKnownZone` guesses yes on an unreadable registry because the
 * cost of guessing wrong is a spurious 404 on a page that would have been
 * corrected downstream anyway. Here the cost of guessing is serving ANOTHER
 * ZONE'S DATA under this zone's name — the exact bug this resolver was written
 * to fix. There is no safe guess, so a refusal means the caller must refuse.
 *
 * Answers `{ok: true, url: null}` when the slug is unknown or the row exists with
 * no `query_url` recorded (a zone registered but never given an endpoint —
 * `reachability: 'unconfigured'`), and `{ok: false}` with the registry's own
 * status when it could not be read — so the caller can tell "your session was
 * refused" (401/403, which the browser must see to refresh) from "the registry
 * is unreadable" (a refusal to route).
 *
 * Served from the routing snapshot when it is fresh; see ROUTING_TTL_MS.
 */
export async function zoneQueryURL(slug: string): Promise<ZoneLookup> {
  const cookieStore = await cookies();
  if (!cookieStore.get(ACCESS_COOKIE)?.value) return { ok: false, status: 401, code: null };

  const snapshot = routingSnapshot;
  if (snapshot && Date.now() - snapshot.at < ROUTING_TTL_MS) {
    const hit = snapshot.zones.find((z) => z.slug === slug);
    const url = hit ? queryURLOf(hit) : null;
    if (url) return { ok: true, url };
    // Unknown to a fresh snapshot, or cached with no query_url: either may
    // have changed since. Read live rather than refuse on a stale answer.
  }

  const read = await readRegistry(cookieStore.toString());
  if (!read.ok) return read;

  const zone = read.zones.find((z) => z.slug === slug);
  return { ok: true, url: zone ? queryURLOf(zone) : null };
}

function queryURLOf(zone: Zone): string | null {
  const url = (zone.query_url ?? "").trim().replace(/\/+$/, "");
  return url === "" ? null : url;
}
