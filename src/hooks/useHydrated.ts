"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False on the server and during hydration, true from the first client render
 * after it. For text that legitimately differs between the two — the browser's
 * own timezone, a time formatted in it — render a neutral placeholder until
 * this is true, rather than a value the server computed in UTC. AGENTS.md §5
 * "Hydration".
 */
export function useHydrated(): boolean {
    return useSyncExternalStore(noSubscribe, () => true, () => false);
}
