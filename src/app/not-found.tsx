import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { isKnownZone } from "@/services/registry.server";
import { NotFoundMarker } from "@/components/Navbar";
import { ZONE_COOKIE, zoneFromPathname, zoneHref } from "@/tools/routing.tools";

export const metadata: Metadata = { title: "Page not found" };

/**
 * The 404 — rendered INSIDE the root layout, so the navbar comes back and this
 * page only has to supply a sentence and a door.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THERE ARE TWO DIFFERENT 404s, AND THEY NEED DIFFERENT WORDS (AUTH-PAGES-10).
 *
 * 1. An UNKNOWN ZONE — `[zone]/layout.tsx` called `notFound()` because the
 *    registry has no such slug (mistyped, or retired: a retired slug is spent
 *    forever, which is why the link can never be made to work again).
 * 2. An unknown PAGE inside a real zone — `/appleby/nope`. Blaming the zone here
 *    (the old copy did, and cited a different zone as its example) sends the
 *    user hunting for a zone problem that does not exist.
 *
 * The pathname comes from the `x-mon-pathname` request header `proxy.ts` sets;
 * a not-found page receives no params. `isKnownZone` is the same check the zone
 * layout made — `cache()`d, so no second registry read — and it FAILS OPEN, so
 * an unreadable registry reads as case 2, the less alarming one.
 *
 * The copy is for the person who followed the link, so it is short. The
 * retirement reasoning is behind a disclosure for whoever wants it (GLOBAL-
 * CHROME-11); the registry pages carry the full version for administrators.
 *
 * `NotFoundMarker` tells the navbar which case this is: on case 1 the path's
 * first segment is not a zone, and the switcher, health pill and active link
 * must stop treating it as one (GLOBAL-CHROME-01).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function NotFound() {
  const pathname = (await headers()).get("x-mon-pathname") ?? "";
  const pathZone = zoneFromPathname(pathname);
  const zoneIsReal = pathZone ? await isKnownZone(pathZone) : false;

  // The last zone the user actually chose, written by the scope switcher. A
  // stale value is harmless: `[zone]/layout.tsx` re-validates it.
  const remembered = (await cookies()).get(ZONE_COOKIE)?.value;

  if (pathZone && zoneIsReal) {
    return (
      <Shell>
        <NotFoundMarker unknownZone={null} />
        <Heading>This page doesn&apos;t exist in {pathZone}</Heading>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The zone is fine — only this address is wrong. Pick up from one of its pages:
        </p>
        <Doors
          links={[
            { href: zoneHref(pathZone), label: `${pathZone} events`, primary: true },
            { href: zoneHref(pathZone, "/errors"), label: "Issues" },
            { href: zoneHref(pathZone, "/alerts"), label: "Alerts" },
          ]}
        />
      </Shell>
    );
  }

  if (pathZone) {
    // With no remembered zone, `/` resolves to one that exists and never 404s.
    const door = remembered && remembered !== pathZone
      ? { href: zoneHref(remembered), label: `Go to ${remembered}` }
      : { href: "/", label: "Go to your zone" };
    return (
      <Shell>
        <NotFoundMarker unknownZone={pathZone} />
        <Heading>There is no zone called &ldquo;{pathZone}&rdquo;</Heading>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          It was mistyped, or it has been retired. Choose a zone from the picker
          above, or go back to where you were.
        </p>
        <Doors links={[{ ...door, primary: true }, { href: "/settings/admin/registry", label: "Browse zones (admins)" }]} />
        <details className="group rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <summary className="cursor-pointer font-medium text-zinc-800 dark:text-zinc-200">
            Why can&apos;t a retired zone&apos;s name be reused?
          </summary>
          <p className="mt-2 leading-relaxed text-zinc-600 dark:text-zinc-400">
            A zone&apos;s name is tied to the history recorded under it. Reusing
            the name would attach that old history to a new zone, so a retired
            name stays retired, and links that used it can&apos;t be revived. Ask an
            administrator which zone replaced it.
          </p>
        </details>
      </Shell>
    );
  }

  return (
    <Shell>
      <NotFoundMarker unknownZone={null} />
      <Heading>This page doesn&apos;t exist</Heading>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Check the address, or head back to your dashboard.
      </p>
      <Doors
        links={[
          remembered
            ? { href: zoneHref(remembered), label: `Go to ${remembered}`, primary: true }
            : { href: "/", label: "Go to your zone", primary: true },
        ]}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-16 sm:px-6 lg:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        404 · Not found
      </p>
      {children}
    </main>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="break-words text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
      {children}
    </h1>
  );
}

function Doors({ links }: { links: { href: string; label: string; primary?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={
            l.primary
              ? "inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              : "inline-flex items-center rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
