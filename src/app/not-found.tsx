import Link from "next/link";
import { cookies } from "next/headers";
import { FALLBACK_ZONE, ZONE_COOKIE, zoneHref } from "@/tools/routing.tools";

/**
 * The 404, and specifically the one a RETIRED OR MISTYPED ZONE lands on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WITHOUT THIS FILE, `notFound()` RENDERS OUTSIDE THE ROOT LAYOUT.
 *
 * Next's built-in 404 is a bare black-on-white "404 | This page could not be
 * found". No navbar, no scope control, no logo, no link anywhere — a dead end
 * with no way out but the back button. That is what every user following an old
 * link to a retired zone got, and `[zone]/layout.tsx` calls `notFound()` for
 * exactly that case on purpose (an unknown zone is a 404, never a 403 — see the
 * note there).
 *
 * The registry goes to considerable lengths to explain that a slug is spent
 * FOREVER: `RetireDialog` says it twice, `FixedSlug` says it again, and
 * monitor-core keeps the row rather than deleting it precisely so a retired name
 * can never be recycled onto another tenant's events. None of that reasoning
 * reached the person who followed the link — the one reader for whom it explains
 * the thing they are looking at.
 *
 * A `not-found.tsx` at the app root renders INSIDE `app/layout.tsx`, so the
 * navbar, the theme and the scope control come back, and this page only has to
 * supply the sentence and a door.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function NotFound() {
  // The last zone the user actually chose, written by the scope switcher. It is
  // the only zone we can offer with any confidence from a page whose whole
  // premise is that the zone in the URL is not one — and it is read
  // server-side, like the root layout does, so the link is correct on first
  // paint rather than after a hydration.
  //
  // A bogus or stale value is harmless: `[zone]/layout.tsx` re-validates
  // whatever it resolves to and would send the user straight back here.
  const cookieStore = await cookies();
  const zone = cookieStore.get(ZONE_COOKIE)?.value || FALLBACK_ZONE;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          404
        </p>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          There is nothing at this address
        </h1>
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          The page you asked for does not exist on this install. If you followed a
          link into a zone — the first part of the path, like{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            /{zone}/errors
          </code>{" "}
          — then that zone is not one this install serves.
        </p>
      </div>

      {/* The half nobody can work out for themselves, and the reason this page
          exists rather than a generic "not found". A retired zone is not a
          broken link that someone can fix by re-creating the zone: the slug is
          spent permanently, deliberately, and a reader who does not know that
          will go and try. */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Two ways a zone stops answering
        </h2>
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          <li>
            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
              It was mistyped.
            </strong>{" "}
            Check the spelling against the zone list in the scope control above.
          </li>
          <li>
            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
              It was retired.
            </strong>{" "}
            Retiring a zone keeps its row forever and spends its slug{" "}
            <em>permanently</em> — nobody can create another zone with that name,
            now or ever, because a reused slug would silently reattach the old
            zone&apos;s surviving events and its permanent daily rollup to whatever
            took the name. So this link cannot be made to work again; the data it
            pointed at lives under a different name or nowhere.
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={zoneHref(zone)}
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Go to {zone}
        </Link>
        <Link
          href="/admin/registry"
          className="inline-flex items-center rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Zones &amp; projects
        </Link>
      </div>
      {/* Said out loud because the second button 403s for a non-admin, and a
          button that bounces you is worse than one that warned you. */}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        The registry is admin-only. If you are not an administrator, ask one which
        zone replaced this link.
      </p>
    </main>
  );
}
