import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
    FALLBACK_ZONE,
    NEXT_PARAM,
    ZONE_COOKIE,
    legacyFlatPage,
    nextParamFor,
    safeNextPath,
} from "@/tools/routing.tools";
import type { Zone } from "@/types";

// The control plane's container-network origin — the same expression as
// services/upstream.server.ts and registry.server.ts; keep them in step.
const CONTROL_PLANE = (
    process.env.MONITOR_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_MONITOR_API_URL ||
    "http://localhost:8080"
).replace(/\/+$/, "");

// The proxy sits in front of every navigation, so a control-plane read here
// must never be what a page waits on. Past this, the caller falls back.
const LOOKUP_TIMEOUT_MS = 1_500;

/**
 * GETs a control-plane JSON envelope with the caller's cookies, or null on any
 * failure (status, transport, timeout, shape). Never throws: every caller has
 * a safe fallback, and a proxy that throws takes down every page at once.
 */
async function controlPlaneGet<T>(request: NextRequest, path: string): Promise<T | null> {
    const cookie = request.headers.get("cookie");
    if (!cookie) return null;
    try {
        const res = await fetch(`${CONTROL_PLANE}${path}`, {
            headers: { cookie, accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { success?: boolean; data?: T };
        return body?.success === true && body.data != null ? body.data : null;
    } catch {
        // Unreachable / slow control plane: the caller's fallback is the answer.
        return null;
    }
}

/**
 * The zone a legacy flat link should land in when no `mon-zone` cookie says.
 * Mirrors `app/page.tsx`: the registry's first active zone, else the stock
 * slug. FALLBACK_ZONE alone sent every cookieless visitor to trailblaze, which
 * on an install whose users live in appleby is the wrong tenant.
 */
async function resolveLegacyZone(request: NextRequest): Promise<string> {
    const zones = await controlPlaneGet<Zone[]>(request, "/v1/zones");
    if (!Array.isArray(zones)) return FALLBACK_ZONE;
    const zone = zones.find((z) => z.status === "active") ?? zones[0];
    return zone?.slug || FALLBACK_ZONE;
}

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

/**
 * Passes the pathname to server components as a REQUEST header. The root layout
 * reads it to decide whether the navbar's Suspense fallback reserves the header
 * height: it must on every page with a navbar (or the page jumps when it
 * hydrates in) and must not on /login, /pending and /unauthorized, which have
 * none (or those pages jump the other way).
 */
export const PATHNAME_HEADER = "x-mon-pathname";

function next(request: NextRequest) {
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // A signed-in user on /login is sent on to where they were going instead
    // of being offered a pointless second sign-in.
    //
    // ⚠️ THE COOKIE ALONE IS NOT ENOUGH. mon-logged-in can outlive the session
    // (it is only a JS-readable hint, and a session can be revoked or fail to
    // refresh while it is still set), and every "session failed" path in the client lands HERE. If
    // the cookie were trusted, a dead session would bounce /login → zone →
    // /login forever. So the session is confirmed with /auth/self first; any
    // doubt (401, timeout, unreachable) shows the form. ?error= and
    // ?signed_out are left alone: those visits are the point of the page.
    if (
        pathname === "/login" &&
        request.cookies.has("mon-logged-in") &&
        !request.nextUrl.searchParams.has("error") &&
        !request.nextUrl.searchParams.has("signed_out")
    ) {
        const self = await controlPlaneGet<{ role?: string }>(request, "/auth/self");
        if (self) {
            const url = request.nextUrl.clone();
            url.search = "";
            if (self.role === "pending") {
                url.pathname = "/pending";
            } else {
                // safeNextPath is the open-redirect guard — `next` is attacker-supplied.
                const target = new URL(
                    safeNextPath(request.nextUrl.searchParams.get(NEXT_PARAM)) ?? "/",
                    request.nextUrl.origin,
                );
                url.pathname = target.pathname;
                url.search = target.search;
            }
            return NextResponse.redirect(url);
        }
    }

    if (ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return next(request);
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
    //
    // With no `mon-zone` cookie the zone has to come from the registry, which
    // needs a session. Logged out, the LEGACY path is round-tripped through
    // `next` instead, and resolved here again once they are signed in.
    const loggedIn = request.cookies.has("mon-logged-in");
    if (legacyFlatPage(pathname) && (request.cookies.has(ZONE_COOKIE) || loggedIn)) {
        const zone =
            request.cookies.get(ZONE_COOKIE)?.value || (await resolveLegacyZone(request));
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
    if (!loggedIn) {
        const target = nextParamFor(pathname + request.nextUrl.search);
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "";
        if (target) url.searchParams.set(NEXT_PARAM, target);
        return NextResponse.redirect(url);
    }

    return next(request);
}

export const config = {
    // Run on all paths except static files that Next.js serves directly.
    matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
