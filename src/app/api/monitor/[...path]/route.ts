import { NextRequest, NextResponse } from "next/server";

// MONITOR_API_URL is injected at startup by Keyring (via instrumentation.ts)
// or set directly in the runtime environment.
const UPSTREAM = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");

type Params = { path: string[] };

// Forward the Forta access token cookie so monitor-core can validate it.
function upstreamHeaders(req: NextRequest): HeadersInit {
    const token = req.cookies.get("forta-access-token")?.value;
    return {
        "Content-Type": "application/json",
        ...(token && { Cookie: `forta-access-token=${token}` }),
    };
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/${path.join("/")}${search}`;

    const upstream = await fetch(url, { headers: upstreamHeaders(req) });
    const body = await upstream.text();
    return new NextResponse(body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
    });
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
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
    });
}
