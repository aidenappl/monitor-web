import { cookies } from "next/headers";
import { cache } from "react";
import type { Zone } from "@/types";

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
export const listZones = cache(async (): Promise<Zone[] | null> => {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    if (!cookieHeader) return null;

    const res = await fetch(`${UPSTREAM}/v1/zones`, {
      headers: { Accept: "application/json", Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const body = await res.json();
    return Array.isArray(body?.data) ? (body.data as Zone[]) : null;
  } catch {
    return null;
  }
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
