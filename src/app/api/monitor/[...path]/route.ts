import { NextRequest, NextResponse } from "next/server";
import { resolveUpstream, zoneFromRequest } from "@/services/upstream.server";
import { serverError } from "@/lib/monitor-server";
import { hostOf, isTimeoutError, normalisePath } from "@/tools/telemetry.tools";

type Params = { path: string[] };

type Target = { url: string; zone: string | null; upstreamPath: string };

/**
 * target resolves one request to a concrete upstream URL.
 *
 * ⚠️ The upstream is PER-REQUEST, not per-process. It used to be a module
 * constant, which meant every zone's pages fetched from the control plane's own
 * monitor-core and rendered its data under whatever zone was in the address bar.
 * See services/upstream.server.ts for the full account.
 *
 * Returns either a URL to fetch or a NextResponse to return unchanged — a
 * refusal, never a quiet fallback to the control plane. (The refusal is
 * reported by `resolveUpstream` itself, once for all three bridges.)
 */
async function target(
    req: NextRequest,
    path: string[],
): Promise<Target | { refusal: NextResponse }> {
    const { zone, search } = zoneFromRequest(req.nextUrl);
    const upstreamPath = `/${path.join("/")}`;

    const resolved = await resolveUpstream(upstreamPath, zone, req.method);
    if (!resolved.ok) {
        return {
            refusal: NextResponse.json(
                {
                    success: false,
                    error: "zone_unroutable",
                    error_message: resolved.error,
                    error_code: resolved.status,
                },
                { status: resolved.status },
            ),
        };
    }

    return { url: `${resolved.base}${upstreamPath}${search}`, zone, upstreamPath };
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

/**
 * forward sends one resolved request upstream and relays the answer.
 *
 * ⚠️ A THROWN FETCH IS A 502 IN THE STANDARD ENVELOPE, NEVER A BARE 500.
 * `fetch` throws when monitor-core cannot be reached at all — refused, reset,
 * DNS, a connect or headers timeout. Unhandled, that surfaced as Next's own
 * empty 500, so the page's FailureState said "Request failed" with nothing to
 * say which box was down. It is caught here, reported (once per zone per
 * minute), and answered in the envelope the UI already renders.
 *
 * Upstream STATUSES are relayed, never reported: monitor-core received those
 * requests and logged each one itself.
 */
async function forward(
    req: NextRequest,
    path: string[],
    method: "GET" | "POST" | "PUT" | "DELETE",
): Promise<NextResponse> {
    const resolved = await target(req, path);
    if ("refusal" in resolved) return resolved.refusal;
    const body = method === "POST" || method === "PUT" ? await req.text() : undefined;

    const started = Date.now();
    try {
        const upstream = await fetch(resolved.url, {
            method,
            headers: upstreamHeaders(req),
            body,
        });
        return relay(upstream, await upstream.text());
    } catch (err) {
        const timedOut = isTimeoutError(err);
        serverError("proxy.upstream.failed", err, {
            zone: resolved.zone,
            method,
            path: normalisePath(resolved.upstreamPath),
            upstream_host: hostOf(resolved.url),
            duration_ms: Date.now() - started,
            timed_out: timedOut,
            reason: timedOut
                ? "monitor-core did not answer in time"
                : "the request to monitor-core threw before a response could be relayed",
            outcome: "returned 502 upstream_unreachable",
        });
        const where = resolved.zone ? `zone "${resolved.zone}"` : "the control plane";
        return NextResponse.json(
            {
                success: false,
                error: "upstream_unreachable",
                error_message:
                    `Could not reach the Monitor API for ${where}` +
                    `${timedOut ? " (it timed out)" : ""}. ` +
                    `The backend is unreachable — this is not an empty result.`,
                error_code: 502,
            },
            { status: 502 },
        );
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    return forward(req, path, "GET");
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    return forward(req, path, "POST");
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    return forward(req, path, "PUT");
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<Params> }
) {
    const { path } = await params;
    return forward(req, path, "DELETE");
}
