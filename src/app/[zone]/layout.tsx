import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isKnownZone } from "@/services/registry.server";
import { ScopeBoundary } from "@/components/ScopeBoundary";

/**
 * The zone segment.
 *
 * A ZONE IS A PATH SEGMENT because it selects which backend answers — it has to
 * survive a bookmark and it drives the proxy's upstream choice. The PROJECT
 * inside it is a query param instead, because it is a filter within one backend
 * and may reasonably become multi-valued (Sentry's shape: org in the path,
 * project as a repeatable param). See `tools/routing.tools.ts` for the full
 * argument, including why a query param is the only mechanism that works for
 * both axios and EventSource.
 *
 * This is a SERVER component and validation happens here, before any child
 * renders. Doing it on the client would paint a real dashboard for a zone that
 * does not exist, fire every data effect against it, and only then correct
 * itself.
 *
 * ⚠️ AN UNKNOWN ZONE IS A 404, NEVER A 403. A 403 answers a question nobody
 * asked: it tells an unauthenticated prober which zone slugs exist on this
 * install by responding differently to the ones that do, and it tells a user who
 * simply mistyped that they lack permission — sending them to an administrator
 * instead of to their address bar. "This is not a thing" is the honest answer to
 * a name that is not a thing.
 *
 * Note what is NOT here: no zone fan-out, no cross-zone query, no config pull.
 * The registry is read once, to answer "is this a zone at all".
 *
 * ⚠️ EVERY ZONE-SCOPED PAGE RENDERS INSIDE `ScopeBoundary`, AND THAT IS LOAD-
 * BEARING. It keys its provider on `{zone}::{project}`, so changing either one
 * remounts this entire subtree — which is the only reason a project switch
 * refetches anything at all. See the header on `components/ScopeBoundary.tsx`
 * for the bug it replaces and why it is not eight dependency arrays.
 */
export default async function ZoneLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ zone: string }>;
}) {
  const { zone } = await params;

  if (!(await isKnownZone(zone))) {
    notFound();
  }

  // ⚠️ THE SUSPENSE BOUNDARY IS NOT OPTIONAL. `ScopeBoundary` calls
  // `useSearchParams`, and a client component that does so inside a layout must
  // sit under a suspense boundary or `next build` fails the whole route — the
  // same requirement the root layout satisfies for the Navbar.
  return (
    <Suspense fallback={null}>
      <ScopeBoundary>{children}</ScopeBoundary>
    </Suspense>
  );
}
