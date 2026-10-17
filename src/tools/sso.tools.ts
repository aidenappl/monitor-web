/**
 * Single sign-on helpers.
 *
 * monitor-core ties a Monitor session to the identity provider's session: each
 * /auth/refresh re-confirms it, and when it ends the browser lands on /login.
 * /login first tries a SILENT sign-in — a full-page redirect to the provider
 * with prompt=none. A user still signed in there comes straight back with a
 * new session and never sees the form; otherwise the provider answers
 * login_required and the form is shown.
 */

const SILENT_KEY = "mon-sso-silent-at";

// A silent attempt that returns to /login without an error inside this window
// means the session did not stick (e.g. a blocked cookie). Trying again would
// loop, so the form is shown instead.
const SILENT_RETRY_MS = 60_000;

/** An SSO provider login URL with the deep link and optional prompt. */
export function ssoLoginHref(href: string, opts: { next?: string | null; prompt?: "none" } = {}): string {
  const u = new URL(href, window.location.origin);
  if (opts.next) u.searchParams.set("return_url", opts.next);
  if (opts.prompt) u.searchParams.set("prompt", opts.prompt);
  return u.toString();
}

/** Whether a silent SSO sign-in may be attempted (none in the last minute). */
export function silentSSOAllowed(): boolean {
  try {
    const last = Number(sessionStorage.getItem(SILENT_KEY) ?? 0);
    return Date.now() - last >= SILENT_RETRY_MS;
  } catch {
    return false;
  }
}

/** Navigates to a silent (prompt=none) SSO sign-in and records the attempt. */
export function startSilentSSO(href: string, next: string | null): void {
  try {
    sessionStorage.setItem(SILENT_KEY, String(Date.now()));
  } catch {
    // Without storage there is no loop guard; the provider still answers.
  }
  window.location.replace(ssoLoginHref(href, { next, prompt: "none" }));
}

/** Abandons a silent sign-in that is still navigating away (the "use a password" escape). */
export function cancelSilentSSO(): void {
  // window.stop() aborts a navigation that has not committed yet. The loop
  // guard stays set, so a reload within the minute shows the form too.
  window.stop();
}

const LAST_METHOD_KEY = "mon-last-sign-in";

/** "password", or the slug of the SSO provider last used on this browser. */
export function lastSignInMethod(): string | null {
  try {
    return localStorage.getItem(LAST_METHOD_KEY);
  } catch {
    return null;
  }
}

/**
 * Remembers how this browser last signed in, so /login can point at it. A hint
 * only — written when the attempt STARTS (an SSO click leaves the page), never
 * read as proof of anything.
 */
export function rememberSignInMethod(method: string): void {
  try {
    localStorage.setItem(LAST_METHOD_KEY, method);
  } catch {
    // Without storage there is simply no hint.
  }
}

/** Forgets the loop guard once a session is confirmed working. */
export function clearSilentSSO(): void {
  try {
    sessionStorage.removeItem(SILENT_KEY);
  } catch {
    // Nothing to clear.
  }
}
