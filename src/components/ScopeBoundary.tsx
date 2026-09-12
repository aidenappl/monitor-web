"use client";

import { createContext, useMemo } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { PROJECT_PARAM, publishScope } from "@/tools/routing.tools";

/**
 * THE SCOPE BOUNDARY: one remount per tenant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE BUG THIS EXISTS TO MAKE IMPOSSIBLE.
 *
 * `ScopeSwitcher.selectProject` changes the scope with a searchParams-only
 * `router.push`. That re-renders the components that READ the param and nothing
 * else — and not one page read it. Every observability page fetches from a
 * `useEffect` whose dependency array names its own filters
 * (`[status, service, debouncedSearch, hasPR, sort, view, offset, reloadToken]`)
 * or, on alerts and notifications, is literally `[]`. So switching project moved
 * the label in the navbar and refetched NOTHING: the page went on rendering the
 * previous tenant's issues under the new tenant's name, indefinitely, with every
 * request 200 and nothing in an error state anywhere.
 *
 * The second half is worse. The axios interceptor derives the project from the
 * live URL, so the next unrelated refetch — a poll, a status write, a filter
 * change — adopts the NEW project while the rest of the page still holds the old
 * one's rows. Half the page on each tenant, and no way for the user to tell.
 *
 * ⚠️ WHY THIS IS NOT "ADD `project` TO EIGHT DEPENDENCY ARRAYS".
 *
 * Because that fix is only correct for exactly as long as everyone remembers it,
 * and its failure mode is invisible. Eight arrays today, and every page added
 * after this one starts wrong by default — with the wrong-data symptom above
 * rather than a crash. A keyed provider inverts that default: the subtree is
 * REMOUNTED when the scope changes, so every `useEffect(…, [])` re-runs without
 * naming the project at all, page-local state starts clean, and in-flight
 * responses are dropped by the `cancelled` flags those effects already carry.
 * Correct by construction beats correct by vigilance.
 *
 * ⚠️ WHAT IT COSTS, said out loud because it is a real cost: page-local state
 * resets on a scope change. Filters, time range, selection, pagination — all
 * back to defaults. That is the right trade (a filter is a question about a
 * tenant, and it is not obviously the same question about a different one), but
 * it is a trade. The one place it is genuinely dangerous is the dashboard's
 * debounced autosave, which could fire after the remount and write a
 * half-finished dashboard into the tenant that replaced it — see the unsaved
 * guard in `app/[zone]/dashboard/page.tsx`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The scope of the subtree, as read from the route. */
export interface Scope {
  /** The zone path segment. Non-empty for anything under `/[zone]`. */
  zone: string;
  /** The `?project` selection, or null when the install default applies. */
  project: string | null;
  /**
   * The identity of this scope, and the provider's `key`.
   *
   * `__default__` rather than an empty string so "no project selected" is a
   * value with a name. An empty segment reads as a bug in a key and invites
   * someone to "fix" it by falling back to the zone alone — which would make the
   * default project and every named project share one key, and the remount that
   * this whole file is about would silently stop happening for the one
   * transition users make most.
   */
  scopeKey: string;
}

/**
 * scopeKeyOf builds the identity of a scope.
 *
 * Exported so nothing has to re-derive the format. The dashboard's autosave
 * guard compares the scope an edit was made under against the scope live at the
 * moment the debounce fires, and a second, subtly different formula there — one
 * that folded `null` and `""` together, say — would compare equal across a
 * change that matters and write into the wrong tenant. One definition.
 */
export function scopeKeyOf(zone: string | null, project: string | null): string {
  return `${zone ?? ""}::${project ?? "__default__"}`;
}

/**
 * Null outside the boundary, which is what `useScope()` throws on.
 *
 * A default value here would be the wrong kind of convenience: it would let a
 * component outside `/[zone]` read a scope that no provider is maintaining, get
 * plausible-looking nulls, and quietly issue unscoped requests. Throwing turns
 * that into a mistake you find while writing the component.
 */
export const ScopeContext = createContext<Scope | null>(null);

export function ScopeBoundary({ children }: { children: React.ReactNode }) {
  // Both halves come from the ROUTE and resolve before the first paint. Nothing
  // here waits on a fetch: a boundary whose scope only becomes correct after a
  // request lands is a boundary that remounts a second time when it does.
  const routeZone = useParams()?.zone;
  const zone = typeof routeZone === "string" ? routeZone : "";
  const pathname = usePathname();
  const rawProject = useSearchParams().get(PROJECT_PARAM);
  const project = rawProject?.trim() ? rawProject.trim() : null;

  const scopeKey = scopeKeyOf(zone, project);

  // ⚠️ PUBLISHED FROM RENDER, NOT FROM AN EFFECT, and the ordering is the whole
  // reason. Effects run bottom-up: a child's mount effect fires BEFORE its
  // parent's, so publishing here in a `useEffect` would let the freshly mounted
  // page's data effect read the PREVIOUS scope and fetch the tenant the user
  // just navigated away from. Render is top-down, so this runs before any child
  // renders, let alone fetches.
  //
  // It is a write to a module-level mirror derived purely from the route, so it
  // is idempotent and safe to repeat — which is what makes it tolerable in a
  // render body. It is a no-op during SSR; see `publishScope`.
  publishScope({ zone: zone || null, project, pathname });

  const value = useMemo<Scope>(
    () => ({ zone, project, scopeKey }),
    [zone, project, scopeKey],
  );

  // ⚠️ THE `key` IS THE FEATURE. Everything else in this file is bookkeeping;
  // this line is what forces React to tear the subtree down and build it again
  // when the tenant changes. Remove it and the provider merely re-renders, which
  // is exactly the no-op the switcher already had.
  return (
    <ScopeContext.Provider key={scopeKey} value={value}>
      {children}
    </ScopeContext.Provider>
  );
}
