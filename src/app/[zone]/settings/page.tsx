import { redirect } from "next/navigation";
import { PROJECT_PARAM, zoneHref } from "@/tools/routing.tools";

/**
 * The zone hub's front door opens its first section. Every older link —
 * "Zone settings" in the nav, the registry's "manage keys" links, the retire
 * dialogs — said `/{zone}/settings` and meant the keys, so that is where it
 * goes. The project selector is carried: dropping it would silently switch
 * tenant on the way in.
 */
export default async function ZoneSettingsIndex({
    params,
    searchParams,
}: {
    params: Promise<{ zone: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const [{ zone }, sp] = await Promise.all([params, searchParams]);
    const project = typeof sp[PROJECT_PARAM] === "string" ? sp[PROJECT_PARAM] : null;
    redirect(zoneHref(zone, "/settings/api-keys", project));
}
