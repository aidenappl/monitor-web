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
 * ─────────────────────────────────────────────────────────────────────────────
 */
let refreshPromise: Promise<boolean> | null = null;

/**
 * refreshSession attempts to rotate the session cookies, collapsing concurrent
 * callers onto a single request.
 *
 * Both clients reach monitor-core through the same-origin `/api/monitor` proxy,
 * which rewrites the refresh cookie's `Path=/auth/refresh` so the browser
 * actually sends it — see the proxy route. Calling monitor-core directly would
 * skip that rewrite and the cookie would never be attached.
 *
 * Returns true when the session was renewed. Never throws: a failure here is an
 * expected outcome (the refresh token really can be gone), and the caller
 * decides what to do about it.
 */
export async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch("/api/monitor/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return false;
        // A non-JSON 2xx counts as a failed refresh; monitor-core logged the
        // request itself, so this fallback stays silent.
        const body = await res.json().catch(() => null);
        return body?.success === true;
      } catch (err) {
        // A TRANSPORT failure here ends the session — fetchApi sees `false`
        // and redirects to /login — and it is a raw fetch, so the axios hook
        // never saw it.
        reportError("session.refresh.failed", err, {
          method: "POST",
          url: "/api/monitor/auth/refresh",
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
  if (window.location.pathname !== "/login") {
    window.location.href = loginHref(
      window.location.pathname + window.location.search,
    );
  }
}
