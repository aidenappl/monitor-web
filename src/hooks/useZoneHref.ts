"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
    FALLBACK_ZONE,
    PROJECT_PARAM,
    zoneFromPathname,
    zoneHref,
} from "@/tools/routing.tools";

/**
 * useZoneHref returns a builder for links that stay inside the current scope.
 *
 * Every internal link between zone-scoped pages has to carry both halves of the
 * scope, and each is lost a different way. Drop the zone and the link 404s —
 * loud, and someone fixes it. Drop the project and the link works perfectly
 * while quietly resetting the tenant, which is the failure worth writing a hook
 * to prevent.
 *
 * Scope is read from the ROUTE, synchronously: `usePathname` and
 * `useSearchParams` both resolve before the first paint, so a link is correct on
 * the render that creates it. Reading it from a store hydrated by a fetch would
 * mean handing out wrong URLs until that fetch landed, with nothing to show for
 * it — the href is already in the DOM by then.
 *
 * `path` is the zone-relative tail: `zoned("/errors/9f3")` → `/trailblaze/errors/9f3?project=atlas`.
 */
export function useZoneHref(): (path: string) => string {
    const pathname = usePathname();
    const project = useSearchParams().get(PROJECT_PARAM);
    // FALLBACK_ZONE covers the zone-agnostic pages, where there is no zone in
    // the path but a link into one is still wanted.
    const zone = zoneFromPathname(pathname) ?? FALLBACK_ZONE;

    return useCallback(
        (path: string) => zoneHref(zone, path, project),
        [zone, project],
    );
}
