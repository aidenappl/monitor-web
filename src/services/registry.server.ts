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

/**
 * Why a registry read produced no answer. Travels as `registry_failure` on the
 * `proxy.zone.unroutable` warning it causes, so "no session", "the control
 * plane said 401" and "the control plane is down" are three different events
 * rather than one sentence.
 */
export type RegistryFailure = "no_session" | `http_${number}` | "malformed" | "unreachable";

interface RegistryRead {
  zones: Zone[] | null;
  failure?: RegistryFailure;
}

const REGISTRY_OUTCOME =
  "registry treated as unreadable: zone pages fail open (no 404), and the proxy " +
  "refuses every non-local zone with 502 zone_unroutable";

/**
 * readRegistry is listZones plus the reason when there is no answer.
 *
 * Reports what monitor-core CANNOT see from its side — the request never
 * arriving (thrown fetch) or a 2xx in the wrong shape. A non-2xx is NOT
 * reported here: monitor-core received that request and emitted its own
 * `http.request.end` for it, at the right level.
 */
const readRegistry = cache(async (): Promise<RegistryRead> => {
  const started = Date.now();
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    if (!cookieHeader) return { zones: null, failure: "no_session" };

    const res = await fetch(`${UPSTREAM}/v1/zones`, {
      headers: { Accept: "application/json", Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return { zones: null, failure: `http_${res.status}` };

    const body = await res.json();
    if (Array.isArray(body?.data)) return { zones: body.data as Zone[] };

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
          body && typeof body === "object" ? Object.keys(body).slice(0, 10).join(",") : typeof body,
        reason: "the registry response is not the { data: Zone[] } envelope",
        outcome: REGISTRY_OUTCOME,
      },
    );
    return { zones: null, failure: "malformed" };
  } catch (err) {
    serverError("registry.read.failed", err, {
      method: "GET",
      path: "/v1/zones",
      upstream_host: hostOf(UPSTREAM),
      duration_ms: Date.now() - started,
      timed_out: isTimeoutError(err),
      reason: "the registry read threw (control plane unreachable, or a non-JSON body)",
      outcome: REGISTRY_OUTCOME,
    });
    return { zones: null, failure: "unreachable" };
  }
});

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
 * same question — and deliberately does not persist across requests: the answer
 * is scoped to the caller's cookies.
 */
export const listZones = cache(
  async (): Promise<Zone[] | null> => (await readRegistry()).zones,
);

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

/** Why a zone slug resolved to no upstream. */
export type ZoneUnroutableReason = "registry_unreadable" | "unknown_zone" | "no_query_url";

export type ZoneRoute =
  | { url: string }
  | { url: null; reason: ZoneUnroutableReason; registryFailure?: RegistryFailure };

/**
 * zoneRoute resolves a zone slug to the origin that answers its reads — or says
 * WHY it cannot, so the refusal that follows can be diagnosed.
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
 * to fix. There is no safe guess, so `url: null` means the caller must refuse.
 *
 * Answers `url: null` when the registry is unreadable, the slug is unknown, or
 * the row exists with no `query_url` recorded (a zone registered but never given
 * an endpoint — `reachability: 'unconfigured'`), with `reason` naming which.
 */
export async function zoneRoute(slug: string): Promise<ZoneRoute> {
  const { zones, failure } = await readRegistry();
  if (zones === null) {
    return { url: null, reason: "registry_unreadable", registryFailure: failure };
  }

  const zone = zones.find((z) => z.slug === slug);
  if (!zone) return { url: null, reason: "unknown_zone" };

  const url = (zone.query_url ?? "").trim().replace(/\/+$/, "");
  return url === "" ? { url: null, reason: "no_query_url" } : { url };
}

/** zoneQueryURL is `zoneRoute` without the reason: the origin, or null. */
export async function zoneQueryURL(slug: string): Promise<string | null> {
  return (await zoneRoute(slug)).url;
}
