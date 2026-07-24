import { NextRequest } from "next/server";

const UPSTREAM = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export async function GET(req: NextRequest) {
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/v1/events/stream${search}`;

    // Forward the caller's session cookies verbatim (mon-access-token +
    // mon-refresh-token) exactly like the main proxy, so monitor-core can
    // validate and transparently refresh the token on a long-open stream.
    const headers: HeadersInit = { Accept: "text/event-stream" };
    const cookie = req.headers.get("cookie");
    if (cookie) headers["Cookie"] = cookie;

    const upstream = await fetch(url, {
        headers,
        signal: req.signal,
    });

    if (!upstream.ok || !upstream.body) {
        return new Response(JSON.stringify({ error: "Failed to connect to event stream" }), {
            status: upstream.status || 502,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Pipe the ReadableStream through unbuffered (preserve SSE streaming) and
    // relay any upstream Set-Cookie headers so a refreshed mon-* token pair
    // reaches the browser instead of it reconnect-looping on the stale token.
    const resHeaders = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });
    for (const setCookie of upstream.headers.getSetCookie()) {
        resHeaders.append("set-cookie", setCookie);
    }

    return new Response(upstream.body, {
        status: 200,
        headers: resHeaders,
    });
}
