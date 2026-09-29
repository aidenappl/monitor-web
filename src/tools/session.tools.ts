import Cookies from "js-cookie";
import { loginHref } from "@/tools/routing.tools";
import { reportError } from "@/services/monitor.service";

/**
 * The ONE refresh attempt shared by every HTTP client in this app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THERE MUST BE EXACTLY ONE OF THESE, AND IT MUST BE SHARED.
 *
 * monitor-core implements rotating refresh WITH REUSE DETECTION: presenting a
 * spent refresh token revokes the entire family. So two independent refresh
 * attempts racing is not merely wasteful — the first rotates the token, the
 * second presents the now-spent one, and the user is logged out of everything.
 * A page load fires many requests at once, so that race is the common case, not
 * the rare one.
 *
 * It lives in its own module rather than inside the client because it is also
 * called from the client's own 401 path, and a module-level singleton is the
 * only thing that survives being reached from more than one entry point. The app
 * previously had two clients, each with its own promise — a singleton per client
 * is not a singleton.
 *
 * ⚠️ AND A PER-TAB SINGLETON IS NOT A PER-BROWSER ONE. Every tab shares the same
 * cookie jar but has its own copy of this module, so two tabs whose access
 * tokens expire together race exactly as above. The refresh therefore runs
 * under a cross-tab Web Lock (https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API):
 * the second tab waits for the first, then sees the fresh `mon-refreshed-at`
 * stamp and returns true without presenting the — now spent — cookie it read
 * before waiting; its retry picks up the rotated cookies from the shared jar.
 * Without Web Locks it falls back to the per-tab behaviour; monitor-core's
 * reuse grace window covers what is left.
 * ─────────────────────────────────────────────────────────────────────────────
 */
let refreshPromise: Promise<boolean> | null = null;

/** Cross-tab lock name and localStorage key for the last successful refresh. */
const REFRESH_LOCK = "mon-refresh";
const REFRESHED_AT_KEY = "mon-refreshed-at";
/** A refresh another tab completed this recently is reused, not repeated. */
const REFRESH_REUSE_MS = 10_000;

/**
 * refreshedRecently reports whether any tab refreshed within REFRESH_REUSE_MS.
 * localStorage can throw (disabled storage, privacy modes) — that reads as "no".
 */
function refreshedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(REFRESHED_AT_KEY));
    const age = Date.now() - at;
    return at > 0 && age >= 0 && age < REFRESH_REUSE_MS;
  } catch {
    return false;
  }
}

/**
 * forgetRefresh drops the cross-tab refresh stamp, so a session that has just
 * ended can never be "reused" by another tab's refresh shortcut.
 */
export function forgetRefresh(): void {
  try {
    localStorage.removeItem(REFRESHED_AT_KEY);
  } catch {
    // Storage unavailable — nothing was stored either.
  }
}

/**
 * The refresh endpoint, at the path monitor-core scopes the refresh cookie to —
 * see app/auth/refresh/route.ts for why it cannot live under /api/monitor.
 */
const REFRESH_URL = "/auth/refresh";

/**
 * Where sessions from before that fix hold their refresh cookie: the proxy used
 * to rewrite it to this path. Tried ONLY when the primary path reports no
 * cookie at all, so it runs at most once per such session — the rotated cookie
 * it receives lands on REFRESH_URL — and never presents a token that the
 * primary path has already judged.
 */
const LEGACY_REFRESH_URL = "/api/monitor/auth/refresh";

/** monitor-core's error_message when the request carried no refresh cookie. */
const NO_REFRESH_COOKIE = "no refresh token";

async function postRefresh(url: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "include",
    // Bounded so a hung request can't hold the cross-tab lock forever.
    signal: AbortSignal.timeout(10_000),
  });
}

async function doRefresh(): Promise<boolean> {
  // Can mask a server-side revocation for ≤10s; the next 401 then recovers.
  if (refreshedRecently()) return true;
  try {
    let res = await postRefresh(REFRESH_URL);
    let body = await res.json().catch(() => null);
    if (res.status === 401 && body?.error_message === NO_REFRESH_COOKIE) {
      res = await postRefresh(LEGACY_REFRESH_URL);
      body = await res.json().catch(() => null);
    }
    if (!res.ok || body?.success !== true) return false;
    try {
      localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — other tabs just refresh for themselves.
    }
    return true;
  } catch (err) {
    // A TRANSPORT failure here ends the session — fetchApi sees `false` and
    // redirects to /login — and it is a raw fetch, so the axios hook never saw
    // it. A non-2xx is NOT reported: monitor-core answered and logged it.
    reportError("session.refresh.failed", err, {
      method: "POST",
      url: REFRESH_URL,
      outcome: "refresh reported failed; fetchApi ends the session and redirects to /login",
    });
    return false;
  }
}

/**
 * refreshSession attempts to rotate the session cookies, collapsing concurrent
 * callers onto a single request.
 *
 * The refresh goes to same-origin `/auth/refresh` — the path monitor-core
 * scopes the refresh cookie to, so the browser attaches it whether the session
 * came from a native login (through the proxy) or SSO (set directly by
 * monitor-core). Calling monitor-core's host directly would be cross-origin.
 *
 * Returns true when the session was renewed. Never throws: a failure here is an
 * expected outcome (the refresh token really can be gone), and the caller
 * decides what to do about it.
 */
export async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.locks) {
          return await navigator.locks.request(REFRESH_LOCK, doRefresh);
        }
        return await doRefresh();
      } catch (err) {
        // doRefresh never throws, so this is the Web Locks API itself failing.
        // The session ends on it, so it is reported — with its own reason, not
        // as a transport failure.
        reportError("session.refresh.failed", err, {
          reason: "the cross-tab refresh lock could not be acquired",
          outcome: "refresh reported failed; fetchApi ends the session and redirects to /login",
        });
        return false;
      }
    })().finally(() => {
      // Cleared in `finally` so a failed refresh does not permanently pin every
      // future caller to the same rejected result.
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * endSession clears the JS-readable login flag and sends the user to /login,
 * remembering the page they were on.
 *
 * The deep link matters MORE here than on the middleware's redirect: this fires
 * when a session dies mid-session, so the user was already reading something
 * specific. Dropping the URL means an expired token silently costs them their
 * place — including the zone and project selector, which live in that string.
 *
 * Guarded against redirecting when already on /login, which would otherwise
 * loop: the login page itself makes requests that can 401.
 */
export function endSession(): void {
  if (typeof window === "undefined") return;
  Cookies.remove("mon-logged-in", { path: "/" });
  forgetRefresh();
  if (window.location.pathname !== "/login") {
    window.location.href = loginHref(
      window.location.pathname + window.location.search,
    );
  }
}
