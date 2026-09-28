import { NextRequest, NextResponse } from "next/server";
import { resolveUpstream } from "@/services/upstream.server";

/**
 * POST /auth/refresh — the browser's session refresh, served at the SAME PATH
 * monitor-core scopes the refresh cookie to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THIS IS NOT UNDER /api/monitor, AND WHY THAT MATTERS.
 *
 * monitor-core writes `mon-refresh-token` with `Path=/auth/refresh` on the
 * shared cookie domain. A browser only sends a cookie to request paths inside
 * its Path (RFC 6265 §5.1.4), so it is never attached to
 * `/api/monitor/auth/refresh`.
 *
 * The proxy used to paper over that by rewriting the Path on the Set-Cookie
 * headers IT relayed. But an SSO login never passes through the proxy: the
 * callback is a top-level redirect straight to monitor-core, which sets the
 * cookie itself. Every SSO session therefore held its refresh token at
 * `/auth/refresh`, every refresh went to `/api/monitor/auth/refresh` without
 * it, monitor-core answered "no refresh token", and the user was sent to
 * /login fifteen minutes after signing in — every time.
 *
 * Serving refresh at the cookie's own path makes both login routes work with
 * no Path games at all: this handler relays monitor-core's Set-Cookie
 * VERBATIM, and so does the proxy now.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(req: NextRequest) {
  // /auth/* is the control plane's by definition; this never refuses.
  const upstream = await resolveUpstream("/auth/refresh", null);
  if (!upstream.ok) {
    return NextResponse.json(
      { success: false, error: upstream.reason, error_message: upstream.error, error_code: upstream.status },
      { status: upstream.status },
    );
  }

  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;

  let res: Response;
  let body: string;
  try {
    res = await fetch(`${upstream.base}/auth/refresh`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    body = await res.text();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "upstream_unreachable",
        error_message: "The session service could not be reached.",
        error_code: 502,
      },
      { status: 502 },
    );
  }

  const out = new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
  for (const setCookie of res.headers.getSetCookie()) {
    out.headers.append("set-cookie", setCookie);
  }
  return out;
}
