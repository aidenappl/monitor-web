"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import Cookies from "js-cookie";
import { useAuthContext } from "@/context/AuthContext";
import { useAuth } from "@/store/hooks";
import { reqGetSelf } from "@/services/auth.service";
import { Button } from "@/components/ui/button";

/** How often a parked account asks whether it has been approved. */
const POLL_MS = 30_000;

// The cookie is read in the browser only. On the server there is no answer, so
// the actions render nothing rather than a guess that hydration then flips.
const noSubscribe = () => () => {};
const hasSessionCookie = () => Boolean(Cookies.get("mon-logged-in"));
const unknownOnServer = () => null;

/**
 * Leaves the page once the account is approved. `/` is the zone resolver — the
 * last-used zone, else the registry's first — and a full load rather than a
 * router push, so AuthProvider re-hydrates the user with the new role.
 */
function enterMonitor() {
  window.location.href = "/";
}

// Shown when the API returns 403 error_code 4004 — an authenticated account whose
// role is still "pending" (freshly SSO-provisioned, awaiting admin approval).
//
// ⚠️ IT WAS A DEAD END IN BOTH DIRECTIONS. An approved user stayed parked until
// they guessed to sign out and back in, and a logged-out visitor (a bookmark, a
// link from an approval email) was offered "Sign out" for a session they did
// not have. Now the page watches for the approval itself — a poll every 30s
// while the tab is visible, plus "Check again" — and a visitor with no session
// is sent to sign in instead.
export default function Page() {
  const { logout } = useAuthContext();
  const { user, isLoading } = useAuth();
  const hasSession = useSyncExternalStore(noSubscribe, hasSessionCookie, unknownOnServer);

  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    // A failed read is shown, never read as "still pending": that would tell
    // someone they are waiting on an administrator when the check itself broke.
    // A dead session is fetchApi's to handle — it refreshes, or ends the
    // session and goes to /login.
    const res = await reqGetSelf();
    inFlight.current = false;
    setChecking(false);
    if (res.success && res.data.role !== "pending") {
      enterMonitor();
      return;
    }
    setLastChecked(new Date());
    setCheckError(res.success ? null : res.error_message || "The account check failed.");
  }, []);

  // AuthProvider already read the account once on load; an approved account
  // that lands here (an old tab, a bookmark) goes straight in.
  useEffect(() => {
    if (user && user.role !== "pending") enterMonitor();
  }, [user]);

  useEffect(() => {
    if (!hasSession) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    // Coming back to a tab left open overnight checks at once, not up to 30s later.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasSession, check]);

  const email = user?.email;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <Image
        // Transparent, as the navbar uses: the Dark tile is a black square on
        // the light theme.
        src="/Monitor-Logo-Transparent.svg"
        alt="Monitor"
        width={48}
        height={48}
        className="h-12 w-12"
        priority
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-primary">Account pending approval</h1>
        {hasSession === false ? (
          <p className="max-w-md text-sm text-secondary">
            Accounts created through single sign-on wait here until an administrator grants
            access. Sign in to see whether yours has been approved.
          </p>
        ) : (
          <>
            {email && (
              <p className="text-sm text-secondary">
                Requested as <span className="font-medium text-primary">{email}</span>
              </p>
            )}
            <p className="max-w-md text-sm text-secondary">
              An administrator needs to approve your account before you can use Monitor. Ask
              a Monitor administrator to approve it under Admin → Users. This page checks
              every 30 seconds and takes you in as soon as it&apos;s approved.
            </p>
          </>
        )}
      </div>

      {hasSession === false && (
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign in
        </Link>
      )}

      {/* Nothing until the session check settles, so the actions never flash. */}
      {hasSession && !isLoading && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-col-reverse items-center gap-3 sm:flex-row">
            <Button variant="secondary" size="lg" onClick={() => logout()}>
              Sign out
            </Button>
            <Button size="lg" loading={checking} onClick={() => void check()}>
              Check again
            </Button>
          </div>
          {/* Announced, so a screen-reader user who pressed "Check again" hears
              the outcome rather than nothing. */}
          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-xs text-muted">
            {checkError ? (
              <span className="text-failed">Couldn&apos;t check your account: {checkError}</span>
            ) : lastChecked ? (
              <>
                Still pending — checked at{" "}
                {lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </>
            ) : null}
          </p>
        </div>
      )}
    </main>
  );
}
