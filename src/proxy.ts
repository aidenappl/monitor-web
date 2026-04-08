import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that are always allowed without authentication.
// Everything else requires a valid forta-access-token cookie.
const ALLOWED_PREFIXES = [
    "/forta/",     // OAuth2 login / callback / logout
    "/api/",       // Next.js API routes (the proxy and auth self)
    "/_next/",     // Next.js internals
    "/favicon/",   // Static assets
];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return NextResponse.next();
    }

    // Require the Forta access-token cookie. The actual JWT is validated
    // server-side; here we just gate page navigation.
    if (!request.cookies.has("forta-access-token")) {
        const api = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");
        return NextResponse.redirect(`${api}/forta/login`);
    }

    return NextResponse.next();
}

export const config = {
    // Run on all paths except static files that Next.js serves directly.
    matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
