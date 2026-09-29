import type { NextRequest } from "next/server";
import { MONITOR_SERVICE } from "@/tools/telemetry.tools";

/**
 * Same-origin relay for this app's BROWSER telemetry. Pages post here and this
 * route forwards to Monitor's appleby zone with the ingest key, which never
 * reaches the browser.
 *
 * ⚠️ NOT `/api/monitor`. That path is the upstream proxy to monitor-core — the
 * thing this app is a dashboard FOR. This is the app reporting on itself.
 *
 * It spends the server's key, so it relays only for this app's own pages, only
 * under this app's service name, and only bounded batches. Monitor's status is
 * passed back, so the SDK's retry and bad-line isolation work as they would
 * against ingest directly. The caller's cookies are never forwarded.
 *
 * `proxy.ts` lets every `/api/` path through without a session, so the login
 * page's own failures are reportable.
 */
const MAX_BODY_BYTES = 512 * 1024;
const MAX_EVENTS = 500;
const FORWARD_TIMEOUT_MS = 5000;

const sameOrigin = (req: NextRequest): boolean => {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === req.headers.get("x-forwarded-host") || host === req.headers.get("host");
};

const empty = (status: number): Response => new Response(null, { status });

export async function POST(req: NextRequest): Promise<Response> {
  if (!sameOrigin(req)) return empty(403);

  const ingestUrl = process.env.MON_TELEMETRY_INGEST_URL;
  const apiKey = process.env.MON_TELEMETRY_API_KEY;
  // Not configured: accept and discard, so browsers don't retry into nothing.
  if (!ingestUrl || !apiKey) return empty(204);

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return empty(413);
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return empty(413);

  const lines = body.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return empty(204);
  if (lines.length > MAX_EVENTS) return empty(413);

  // The server's environment name wins when set, so browser and server events
  // from one deployment land under the same `env`.
  const envOverride = process.env.MON_TELEMETRY_ENV;

  const out: string[] = [];
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return empty(400);
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) return empty(400);
    // A page does not get to choose which service it speaks for.
    out.push(
      JSON.stringify({
        ...(event as Record<string, unknown>),
        service: MONITOR_SERVICE,
        ...(envOverride ? { env: envOverride } : {}),
      }),
    );
  }

  try {
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson", "X-Api-Key": apiKey },
      body: out.join("\n"),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      cache: "no-store",
    });
    return empty(res.status);
  } catch {
    // Monitor unreachable: a 503 makes the SDK back off and try again. Not
    // reported — the thing we would report it to is the thing that is down.
    return empty(503);
  }
}
