import { NextRequest, NextResponse } from "next/server";

// MONITOR_API_URL is injected at startup by Keyring (via instrumentation.ts)
// or set directly in the runtime environment.
const UPSTREAM = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");

type Params = { path: string[] };

// Forward the caller's Forta cookies verbatim so monitor-core (via go-forta) can
// validate the access token AND transparently refresh it: go-forta reads the
// forta-refresh-token cookie to mint a new pair when the access token expires.
// Forwarding only forta-access-token silently disables server-side refresh.
function upstreamHeaders(req: NextRequest): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const cookie = req.headers.get("cookie");
    if (cookie) headers["Cookie"] = cookie;
    return headers;
}

// Relay the upstream status, body, and any Set-Cookie headers back to the
// browser. Propagating Set-Cookie is what delivers go-forta's refreshed
// forta-access-token / forta-refresh-token to the client; without it the
// browser keeps sending the expired token and every request 401s.
// getSetCookie() returns a proper string[]; headers.get("set-cookie") would
// comma-join multiple cookies and corrupt them.
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
