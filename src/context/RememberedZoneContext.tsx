"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Cookies from "js-cookie";
import { ZONE_COOKIE } from "@/tools/routing.tools";

/**
 * THE LAST ZONE THE USER WAS IN, for the pages that have none of their own.
 *
 * `/settings` and `/admin/*` carry no zone in the path, but their navbar links,
 * the account page's "API keys" card and every other `useZoneHref` link still
 * have to point INTO one. The answer is "the zone you came from".
 *
 * ⚠️ THE BUG THIS REPLACES. That answer used to be the `mon-zone` cookie alone,
 * and it was wrong two ways at once:
 *   1. The cookie was only ever written by the scope switcher. Anyone who
 *      reached `/appleby` by typing it, from a bookmark, from `/` or from the
 *      login `next` param had no cookie, so every link on `/settings` fell back
 *      to FALLBACK_ZONE — trailblaze. "I clicked Settings in appleby and ended up
 *      in trailblaze."
 *   2. The cookie was read once, server-side, by the ROOT layout, and a client
 *      navigation never re-renders the root layout. So even a freshly written
 *      cookie was invisible until a hard reload. (`useZoneHref` didn't read it
 *      at all.)
 *
 * Now `ScopeBoundary` calls `remember(zone)` whenever a zone page mounts. It
 * renders only after `[zone]/layout.tsx` has validated the slug, so an unknown
 * zone (a 404) is never remembered. `remember` updates this context, which
 * fixes (2), and writes the cookie, which carries the choice to the next full
 * load and to bare `/`.
 *
 * Seeded from the cookie the root layout read on the server, so the server and
 * client passes produce the same hrefs.
 */
interface RememberedZone {
    /** The last zone visited, or null when there is none on record. */
    zone: string | null;
    /** Records `slug` as the last zone, in this tab and in the cookie. */
    remember: (slug: string) => void;
}

const RememberedZoneContext = createContext<RememberedZone>({ zone: null, remember: () => {} });

/**
 * Writes the `mon-zone` cookie. Host-only and path-wide: the root layout reads
 * it back server-side on this same host, and widening it to .appleby.cloud
 * would hand the selection to sibling apps that have no zones to apply it to.
 */
export function rememberZone(slug: string) {
    Cookies.set(ZONE_COOKIE, slug, { path: "/", sameSite: "lax", expires: 365 });
}

export function RememberedZoneProvider({
    initial,
    children,
}: {
    initial?: string;
    children: React.ReactNode;
}) {
    const [zone, setZone] = useState<string | null>(initial || null);

    const remember = useCallback((slug: string) => {
        setZone(slug);
        if (Cookies.get(ZONE_COOKIE) !== slug) rememberZone(slug);
    }, []);

    const value = useMemo(() => ({ zone, remember }), [zone, remember]);
    return <RememberedZoneContext.Provider value={value}>{children}</RememberedZoneContext.Provider>;
}

/** The last zone visited, or null. Only meaningful off a zone path — on one, the path wins. */
export function useRememberedZone(): string | null {
    return useContext(RememberedZoneContext).zone;
}

/** The writer. `ScopeBoundary` is its caller; the switchers navigate into a zone, which reaches it. */
export function useRememberZone(): (slug: string) => void {
    return useContext(RememberedZoneContext).remember;
}
