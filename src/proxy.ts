import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that are always allowed without an authenticated session.
// Everything else requires the JS-readable mon-logged-in cookie. The actual
// JWT is validated server-side by monitor-core; this only gates navigation.
const ALLOWED_PREFIXES = [
    "/login",       // native login + SSO buttons
    "/unauthorized",// grant/role rejection page
    "/pending",     // account awaiting approval
    "/api/",        // Next.js API routes (the monitor proxy + auth)
    "/_next/",      // Next.js internals
    "/favicon",     // Static assets
];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return NextResponse.next();
    }

    // Unauthenticated → the local login page.
    if (!request.cookies.has("mon-logged-in")) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.search = "";
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    // Run on all paths except static files that Next.js serves directly.
    matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
