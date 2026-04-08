import { NextRequest, NextResponse } from "next/server";

// These are server-only env vars — never exposed to the browser.
// MONITOR_API_URL and MONITOR_API_KEY are injected at startup by Keyring
// (via instrumentation.ts) or set directly in the runtime environment.
const UPSTREAM = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const API_KEY = process.env.MONITOR_API_KEY || "";

type Params = { path: string[] };

function upstreamHeaders(): HeadersInit {
    return {
        "Content-Type": "application/json",
        ...(API_KEY && { "X-Api-Key": API_KEY }),
    };
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    const search = req.nextUrl.search;
    const url = `${UPSTREAM}/${path.join("/")}${search}`;

    const upstream = await fetch(url, { headers: upstreamHeaders() });
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
        headers: upstreamHeaders(),
        body,
    });
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
    });
}
