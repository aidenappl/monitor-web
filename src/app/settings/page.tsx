import { redirect } from "next/navigation";

/**
 * `/settings` is the hub's front door, not a page: it opens the first section.
 *
 * The hub used to be one page with `?tab=account|preferences|ai|api-keys`, and
 * those links are in bookmarks, in the "Settings → API keys" copy of two admin
 * dialogs, and in people's heads — so each old tab lands on its new route.
 * `api-keys` lands on Account, whose card leads into the zone you were last in;
 * keys were never really here (see `[zone]/settings/api-keys/page.tsx`).
 */
const TAB_ROUTES: Record<string, string> = {
    account: "/settings/account",
    preferences: "/settings/preferences",
    ai: "/settings/ai",
    "api-keys": "/settings/account",
};

export default async function SettingsIndex({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string | string[] }>;
}) {
    const { tab } = await searchParams;
    redirect(TAB_ROUTES[typeof tab === "string" ? tab : ""] ?? "/settings/account");
}
