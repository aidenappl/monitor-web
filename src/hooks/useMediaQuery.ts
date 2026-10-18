"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tailwind v4's `md` breakpoint (`--breakpoint-md: 48rem`) as a media query.
 * Kept identical to the CSS, so a component that switches layout in JS switches
 * at exactly the width the `md:` utilities around it do.
 */
export const MD_UP = "(min-width: 48rem)";

/**
 * Whether `query` currently matches, re-rendering when that changes.
 *
 * It exists so a component can render ONE layout instead of rendering every
 * layout and hiding the rest behind `hidden md:block` / `md:hidden`. The CSS
 * approach costs nothing for a header; for a list it doubles every row in the
 * DOM, and the hidden copy is still reconciled on every refetch.
 *
 * `serverDefault` is what the server (and the hydration pass) renders, since
 * the server has no viewport. Pick the layout most sessions use; the client
 * corrects it on the first commit after hydration (§5 "Hydration").
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}
