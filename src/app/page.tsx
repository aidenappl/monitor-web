import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listZones } from "@/services/registry.server";
import { FALLBACK_ZONE, ZONE_COOKIE } from "@/tools/routing.tools";

/**
 * Bare `/` is a resolver, not a page. Every real page lives under a zone, and
 * this decides which one the user meant.
 *
 * ⚠️ IT MUST NEVER 404. `/` is the logo link, the post-login landing, and what a
 * user types from memory — a dead root reads as "the whole product is down". So
 * the resolution degrades instead of failing: last-used zone, else the only (or
 * first) zone the registry reports, else the stock slug. A wrong-but-live guess
 * lands on a page that can explain itself; no guess lands nowhere.
 *
 * Whatever it picks is re-validated by `[zone]/layout.tsx` on arrival, so a
 * stale cookie costs a 404 on a real zone name rather than a silent wrong
 * dashboard.
 */
export default async function RootZoneResolver() {
  const zone = await resolveLandingZone();
  // Outside the try below on purpose: redirect() signals by throwing, and a
  // catch around it would swallow the navigation and render nothing.
  redirect(`/${zone}`);
}

async function resolveLandingZone(): Promise<string> {
  try {
    const cookieStore = await cookies();
    // Written by the zone switcher (next task). Until it exists this is always
    // absent and the registry answers — which, for a single-zone install, is the
    // one zone.
    const remembered = cookieStore.get(ZONE_COOKIE)?.value?.trim();

    const zones = await listZones();

    // The registry could not be read: honour the cookie unvalidated rather than
    // overriding a probably-correct memory with a guess. `[zone]/layout.tsx`
    // fails open in the same situation, so this lands on a working page.
    if (zones === null) return remembered || FALLBACK_ZONE;

    // ⚠️ The remembered zone is CHECKED before it is used. Redirecting to a
    // retired or renamed slug would answer `/` with a 404 — the one thing this
    // route must never do — and it would do it on the user's own history rather
    // than on anything they typed.
    if (remembered && zones.some((zone) => zone.slug === remembered)) {
      return remembered;
    }

    const active = zones.find((zone) => zone.status === "active") ?? zones[0];
    if (active) return active.slug;
  } catch {
    // Registry unreachable or no session yet — fall through to the stock slug
    // rather than dead-ending the root of the app on an unrelated outage.
  }

  return FALLBACK_ZONE;
}
