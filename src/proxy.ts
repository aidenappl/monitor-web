import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
    FALLBACK_ZONE,
    NEXT_PARAM,
    ZONE_COOKIE,
    legacyFlatPage,
    nextParamFor,
} from "@/tools/routing.tools";

// Paths that are always allowed without an authenticated session.
// Everything else requires the JS-readable mon-logged-in cookie. The actual
// JWT is validated server-side by monitor-core; this only gates navigation.
const ALLOWED_PREFIXES = [
    "/login",       // native login + SSO buttons
    "/unauthorized",// grant/role rejection page
    "/pending",     // account awaiting approval
    "/api/",        // Next.js API routes (the monitor proxy + auth)
    "/auth/refresh",// session refresh — served at the refresh cookie's own path
    "/_next/",      // Next.js internals
    "/favicon",     // Static assets
    "/Monitor-Logo",// Brand marks — next/image serves SVGs unoptimized, so the
                    // raw /public path is fetched and must not redirect to /login
                    // (it renders in the brand row on every logged-out page)
];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return NextResponse.next();
    }

    // Old flat bookmarks (/errors, /live, …) predate the zone segment. Send them
    // into a zone instead of letting `[zone]/layout.tsx` resolve "errors" as a
    // zone name and 404 — otherwise every saved link, every link in a chat log
    // and anything linking in from outside breaks on the deploy that ships this.
    //
    // Runs BEFORE the session check on purpose: a logged-out user following an
    // old link should be redirected to the new URL and then round-trip THAT
    // through `next`, so they land where they were actually going. Reversing the
    // order would send them to the legacy path after login, and bounce again.
    //
    // The query string is preserved, so `?project=` on a shared link survives.
    if (legacyFlatPage(pathname)) {
        const zone = request.cookies.get(ZONE_COOKIE)?.value || FALLBACK_ZONE;
        const url = request.nextUrl.clone();
        url.pathname = `/${zone}${pathname}`;
        return NextResponse.redirect(url);
    }

    // Unauthenticated → the local login page, carrying where they were going.
    //
    // ⚠️ THE DEEP LINK MUST SURVIVE. This used to clone the URL, overwrite the
    // pathname with /login and blank the search — so a link pasted into chat
    // ("look at /trailblaze/errors/9f3?project=atlas") was destroyed by the
    // session check, and the recipient landed on a generic dashboard with no
    // indication that anything had been dropped. They cannot recover it: the URL
    // they were sent is gone from the address bar.
    //
    // Now the whole path AND query round-trip through `next`, and the login page
    // honours it. The zone and the project selector both live in that string, so
    // losing it loses the scope as well as the page.
    if (!request.cookies.has("mon-logged-in")) {
        const target = nextParamFor(pathname + request.nextUrl.search);
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "";
        if (target) url.searchParams.set(NEXT_PARAM, target);
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    // Run on all paths except static files that Next.js serves directly.
    matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
