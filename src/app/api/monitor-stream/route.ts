import { NextRequest } from "next/server";
import { resolveUpstream, zoneFromRequest } from "@/services/upstream.server";
import { STREAM_REFUSAL_HEADER } from "@/tools/stream.tools";
import { serverError, serverWarn } from "@/lib/monitor-server";
import { hostOf, isTimeoutError } from "@/tools/telemetry.tools";

const STREAM_PATH = "/v1/events/stream";

export async function GET(req: NextRequest) {
    // ⚠️ A stream is the worst place to resolve this wrong. It came from a
    // module constant until the second zone existed, so a tail opened from
    // /{zone}/live connected, delivered well-formed frames, and they were the
    // control plane zone's events. It refuses loudly now instead.
    const { zone, search } = zoneFromRequest(req.nextUrl);
    const resolved = await resolveUpstream(STREAM_PATH, zone, "GET");
    if (!resolved.ok) {
        // ⚠️ THE CLIENT CANNOT SEE ANY OF THIS OVER EVENTSOURCE — not the status,
        // not the body. It reads as a bare `error` event and an automatic
        // reconnect, which is why the live tail sat on "Disconnected" forever
        // against an unroutable zone. The header and body are recovered by a
        // deliberate `fetch` once the client stops retrying; see
        // `tools/stream.tools.ts`.
        return new Response(
            JSON.stringify({ error: resolved.error }),
            {
                status: resolved.status,
                headers: {
                    "Content-Type": "application/json",
                    [STREAM_REFUSAL_HEADER]: resolved.reason,
                },
            },
        );
    }
    const url = `${resolved.base}${STREAM_PATH}${search}`;

    // Forward the caller's session cookies verbatim (mon-access-token +
    // mon-refresh-token) exactly like the main proxy, so monitor-core can
    // validate and transparently refresh the token on a long-open stream.
    const headers: HeadersInit = { Accept: "text/event-stream" };
    const cookie = req.headers.get("cookie");
    if (cookie) headers["Cookie"] = cookie;

    const started = Date.now();
    let upstream: Response;
    try {
        upstream = await fetch(url, {
            headers,
            signal: req.signal,
        });
    } catch (err) {
        // The browser went away (tab closed, EventSource.close() on unmount)
        // and aborted the signal. Not a failure — nobody is listening. 499 is
        // the "client closed request" convention; no one will read it.
        if (req.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
            return new Response(null, { status: 499 });
        }
        // Unhandled, this was Next's bare 500. It is reported and answered in
        // the `{error}` shape `probeStreamRefusal` reads.
        const timedOut = isTimeoutError(err);
        serverError("stream.upstream.failed", err, {
            stream: "events",
            zone,
            method: "GET",
            path: STREAM_PATH,
            upstream_host: hostOf(resolved.base),
            duration_ms: Date.now() - started,
            timed_out: timedOut,
            reason: "the stream request to monitor-core threw before the stream opened",
            outcome: "returned 502; the live tail retries, then probes and shows the reason",
        });
        return new Response(
            JSON.stringify({
                error:
                    `Could not reach the event stream for ` +
                    `${zone ? `zone "${zone}"` : "the control plane"}` +
                    `${timedOut ? " (it timed out)" : ""}.`,
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
        );
    }

    if (!upstream.ok || !upstream.body) {
        // 401/403 are routine session expiry, handled by the client's refresh
        // path — not a warning.
        if (upstream.status !== 401 && upstream.status !== 403) {
            serverWarn("stream.upstream.refused", {
                stream: "events",
                zone,
                status: upstream.status,
                has_body: upstream.body !== null,
                method: "GET",
                path: STREAM_PATH,
                upstream_host: hostOf(resolved.base),
                reason: "monitor-core answered the stream request without opening a stream",
                outcome: `returned ${upstream.status || 502}; the live tail retries, then probes and shows the reason`,
            });
        }
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
