import { NextRequest, NextResponse } from "next/server";

// MONITOR_API_URL is injected at startup by Keyring (via instrumentation.ts)
// or set directly in the runtime environment.
const UPSTREAM = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");

type Params = { path: string[] };

// Forward the caller's mon-* cookies verbatim so monitor-core can validate the
// mon-access-token and rotate the mon-refresh-token. Also forward the CSRF
// double-submit header (read by the browser from the JS-readable mon-csrf
// cookie) so state-changing auth/admin requests pass CSRF enforcement.
function upstreamHeaders(req: NextRequest): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const cookie = req.headers.get("cookie");
    if (cookie) headers["Cookie"] = cookie;
    const csrf = req.headers.get("x-csrf-token");
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return headers;
}

// The backend scopes mon-refresh-token to Path=/auth/refresh. Because the
// browser reaches the refresh endpoint through this proxy at
// /api/monitor/auth/refresh, we rewrite that path so the cookie is actually
// sent back on the proxied refresh call. All other cookies use Path=/.
function rewriteRefreshCookiePath(setCookie: string): string {
    return setCookie.replace(
        /(;\s*)Path=\/auth\/refresh\b/i,
        "$1Path=/api/monitor/auth/refresh"
    );
}

// Relay the upstream status, body, and any Set-Cookie headers back to the
// browser. Propagating Set-Cookie delivers the refreshed / rotated mon-*
// cookies to the client. getSetCookie() returns a proper string[];
// headers.get("set-cookie") would comma-join multiple cookies and corrupt them.
function relay(upstream: Response, body: string): NextResponse {
    const res = new NextResponse(body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
    });
    for (const cookie of upstream.headers.getSetCookie()) {
        res.headers.append("set-cookie", rewriteRefreshCookiePath(cookie));
    }
    return res;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/${path.join("/")}${search}`;

    const upstream = await fetch(url, { headers: upstreamHeaders(req) });
    return relay(upstream, await upstream.text());
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/${path.join("/")}${search}`;
    const body = await req.text();

    const upstream = await fetch(url, {
        method: "POST",
        headers: upstreamHeaders(req),
        body,
    });
    return relay(upstream, await upstream.text());
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/${path.join("/")}${search}`;
    const body = await req.text();

    const upstream = await fetch(url, {
        method: "PUT",
        headers: upstreamHeaders(req),
        body,
    });
    return relay(upstream, await upstream.text());
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/${path.join("/")}${search}`;

    const upstream = await fetch(url, {
        method: "DELETE",
        headers: upstreamHeaders(req),
    });
    return relay(upstream, await upstream.text());
}
