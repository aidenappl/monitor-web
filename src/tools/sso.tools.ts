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

/** Forgets the loop guard once a session is confirmed working. */
export function clearSilentSSO(): void {
  try {
    sessionStorage.removeItem(SILENT_KEY);
  } catch {
    // Nothing to clear.
  }
}
