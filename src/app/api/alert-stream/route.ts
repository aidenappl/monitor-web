import { NextRequest } from "next/server";

const UPSTREAM = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export async function GET(req: NextRequest) {
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/v1/alerts/stream${search}`;

    const token = req.cookies.get("forta-access-token")?.value;
    const headers: HeadersInit = {
        Accept: "text/event-stream",
        ...(token && { Cookie: `forta-access-token=${token}` }),
    };

    const upstream = await fetch(url, {
        headers,
        signal: req.signal,
    });

    if (!upstream.ok || !upstream.body) {
        return new Response(JSON.stringify({ error: "Failed to connect to alert stream" }), {
            status: upstream.status || 502,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(upstream.body, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
