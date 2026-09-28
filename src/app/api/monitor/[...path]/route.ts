import { NextRequest, NextResponse } from "next/server";
import { resolveUpstream, zoneFromRequest } from "@/services/upstream.server";

type Params = { path: string[] };

/**
 * target resolves one request to a concrete upstream URL.
 *
 * ⚠️ The upstream is PER-REQUEST, not per-process. It used to be a module
 * constant, which meant every zone's pages fetched from the control plane's own
 * monitor-core and rendered its data under whatever zone was in the address bar.
 * See services/upstream.server.ts for the full account.
 *
 * Returns either a URL to fetch or a NextResponse to return unchanged — a
 * refusal, never a quiet fallback to the control plane.
 */
async function target(
    req: NextRequest,
    path: string[],
): Promise<{ url: string } | { refusal: NextResponse }> {
    const { zone, search } = zoneFromRequest(req.nextUrl);
    const upstreamPath = `/${path.join("/")}`;

    const resolved = await resolveUpstream(upstreamPath, zone);
    if (!resolved.ok) {
        return {
            refusal: NextResponse.json(
                {
                    success: false,
                    error: resolved.reason,
                    error_message: resolved.error,
                    error_code: resolved.code ?? resolved.status,
                },
                { status: resolved.status },
            ),
        };
    }

    return { url: `${resolved.base}${upstreamPath}${search}` };
}

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

// Relay the upstream status, body, and any Set-Cookie headers back to the
// browser. Propagating Set-Cookie delivers the mon-* cookies from login and
// logout. getSetCookie() returns a proper string[]; headers.get("set-cookie")
// would comma-join multiple cookies and corrupt them.
//
// ⚠️ Cookies are relayed VERBATIM. This used to rewrite the refresh cookie's
// Path=/auth/refresh to /api/monitor/auth/refresh, which only ever fixed logins
// that came through here — SSO sets the cookie directly from monitor-core and
// kept the original path. Refresh is now served at /auth/refresh itself (see
// app/auth/refresh/route.ts), so every login lands the cookie on one path.
function relay(upstream: Response, body: string): NextResponse {
    const res = new NextResponse(body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
    });
    for (const cookie of upstream.headers.getSetCookie()) {
        res.headers.append("set-cookie", cookie);
    }
    return res;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const resolved = await target(req, path);
    if ("refusal" in resolved) return resolved.refusal;

    const upstream = await fetch(resolved.url, { headers: upstreamHeaders(req) });
    return relay(upstream, await upstream.text());
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const resolved = await target(req, path);
    if ("refusal" in resolved) return resolved.refusal;
    const body = await req.text();

    const upstream = await fetch(resolved.url, {
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
    const resolved = await target(req, path);
    if ("refusal" in resolved) return resolved.refusal;
    const body = await req.text();

    const upstream = await fetch(resolved.url, {
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
    const resolved = await target(req, path);
    if ("refusal" in resolved) return resolved.refusal;

    const upstream = await fetch(resolved.url, {
        method: "DELETE",
        headers: upstreamHeaders(req),
    });
    return relay(upstream, await upstream.text());
}
