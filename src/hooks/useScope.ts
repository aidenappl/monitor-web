"use client";

import { useContext } from "react";
import { ScopeContext, type Scope } from "@/components/ScopeBoundary";

/**
 * useScope returns the zone and project the surrounding subtree is rendering.
 *
 * ⚠️ READ THIS INSTEAD OF `useSearchParams().get(PROJECT_PARAM)` ON ANY PAGE
 * UNDER `/[zone]`. Not because the param read is wrong — it returns the same
 * string — but because it hides the fact that changing it does nothing on its
 * own. A component that reads the param directly looks scoped and behaves
 * unscoped; every page in this app was that shape before `ScopeBoundary`
 * existed. A `scripts/guards.mjs` check fails the build on the direct read for
 * exactly that reason.
 *
 * Sibling of `useZoneHref`, which answers the other half: that one builds links
 * that CARRY the scope, this one reports the scope you are IN.
 *
 * ⚠️ IT THROWS OUTSIDE THE BOUNDARY, ON PURPOSE. Returning a null scope would
 * let an account-level page (`/settings`, `/admin/*`) read plausible nulls and
 * issue requests with no tenant, which is the failure that made a zone's API
 * keys unreachable from `/settings` in the first place. A component that needs a
 * scope needs to be inside one; the throw says so at the moment you write it,
 * not months later in a support thread.
 */
export function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) {
    throw new Error(
      "useScope() was called outside <ScopeBoundary>. It is mounted by " +
        "app/[zone]/layout.tsx, so this component is on a zone-agnostic route " +
        "(/settings, /admin/*, /login). Move it under /[zone], or take the zone " +
        "and project as props from the row you are describing.",
    );
  }
  return scope;
}
