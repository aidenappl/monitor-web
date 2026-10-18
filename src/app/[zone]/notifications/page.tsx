import { redirect } from "next/navigation";

/**
 * Notification routing moved into zone settings (`/{zone}/settings/notifications`).
 * Every query param is kept — `?project` (the tenant) and `?tab` (a link to the
 * Channels tab) both mean the same thing there. Here rather than in
 * next.config redirects: under `[zone]/layout.tsx` the zone has already been
 * validated, and a `/:zone/notifications` pattern would also match paths that
 * are not zones.
 */
export default async function NotificationsMoved({
    params,
    searchParams,
}: {
    params: Promise<{ zone: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const [{ zone }, sp] = await Promise.all([params, searchParams]);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
        for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
    }
    const q = qs.toString();
    redirect(`/${zone}/settings/notifications${q ? `?${q}` : ""}`);
}
