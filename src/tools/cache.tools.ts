import { ApiResult } from "@/types/auth.types";

/**
 * A short-lived, in-memory cache for READ-ONLY SUGGESTION DATA — label values,
 * data keys, data values. Nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THIS IS SO NARROW. The same four label lists are asked for by the
 * events page, the live tail, analytics, performance and the dashboard, and each
 * one is a ClickHouse scan. Walking events → live → events re-ran all of them.
 * Caching them for a minute and a half costs nothing a user could notice: a
 * service that started logging 30 seconds ago is missing from a dropdown, not
 * from the data.
 *
 * That argument does not extend to anything a user WRITES. Issues, views,
 * dashboards and service-repos change under the user's own hand, and a cache
 * there shows them the state from before their click. Do not widen this.
 * Hand-rolled on purpose: SWR/React Query are not used in this codebase.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The rules, each of which is load-bearing:
 *
 *  - THE KEY IS THE CALLER'S, AND IT MUST CARRY THE TENANT. The caller builds it
 *    from the same `currentZone()`/`currentProject()` the axios interceptor
 *    scopes the request by (and sends them explicitly, so the two cannot
 *    disagree). A key without them would serve one project's services to
 *    another project's page after a scope switch.
 *  - IN-FLIGHT PROMISES ARE SHARED. Two components mounting together ask once.
 *    That is also why a caller must never cancel through here: an abort would
 *    cancel every waiter's request, and `fetchApi` reports a cancel as a
 *    `network_error`, so each of them would render a failure. Supersede with a
 *    stale-response guard at the call site instead.
 *  - FAILURES ARE NEVER CACHED. A `!success` result is evicted the moment it
 *    lands, so the next ask — a retry button, a re-open — goes to the network.
 *  - NOT ON THE SERVER. This module instance is shared by every concurrent SSR
 *    request, so an entry written there would be served to another user. Same
 *    reason `publishScope` is a no-op on the server.
 *  - BOUNDED. At most MAX_ENTRIES keys, oldest first out; logout and session end
 *    are full-page navigations, which drop the module and everything in it.
 */

const MAX_ENTRIES = 200;

interface Entry {
    /** When the request was made. The TTL runs from here, in-flight included. */
    at: number;
    promise: Promise<ApiResult<unknown>>;
}

const entries = new Map<string, Entry>();

/**
 * cachedRead returns the cached result for `key` while it is younger than
 * `ttlMs`, otherwise calls `load` and caches what it returns.
 */
export function cachedRead<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<ApiResult<T>>,
): Promise<ApiResult<T>> {
    if (typeof window === "undefined") return load();

    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) {
        return hit.promise as Promise<ApiResult<T>>;
    }

    // Evict only the entry THIS call made: by the time a slow failure lands, a
    // newer request may already own the key, and deleting that would throw away
    // a good answer.
    const evict = () => {
        if (entries.get(key)?.promise === promise) entries.delete(key);
    };
    const promise: Promise<ApiResult<T>> = load().then(
        (res) => {
            if (!res.success) evict();
            return res;
        },
        (err: unknown) => {
            evict();
            throw err;
        },
    );

    // Re-inserting moves the key to the end, so insertion order stays oldest
    // first and the cap below trims the stalest entries.
    entries.delete(key);
    entries.set(key, { at: now, promise });
    while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
    }

    return promise;
}
