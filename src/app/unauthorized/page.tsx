"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import Cookies from "js-cookie";
import { useAuthContext } from "@/context/AuthContext";
import { useAuth } from "@/store/hooks";
import { Button } from "@/components/ui/button";

// Shown when the API returns 403 error_code 4003 — a signed-in account whose
// role does not allow what it just tried (a viewer attempting a write, a
// non-admin on an admin page). Locally built — no external auth SDK.
//
// ⚠️ "Back to sign in" alone was a loop for a signed-in user: /login forwards
// a live session straight back into Monitor, onto the page that sent them
// here. So when there is a session, the page names the account that was
// refused and the primary action is to sign OUT and use another one; the way
// back into Monitor is kept for a viewer who only hit one write control.
// The cookie is read in the browser only (as on /pending): on the server there
// is no answer, so the actions render nothing rather than a guess.
const noSubscribe = () => () => {};
const hasSessionCookie = () => Boolean(Cookies.get("mon-logged-in"));
const unknownOnServer = () => null;

export default function Page() {
  const { logout } = useAuthContext();
  const { user, isLoading } = useAuth();
  const hasSession = useSyncExternalStore(noSubscribe, hasSessionCookie, unknownOnServer);
  // ⚠️ No user is not the same as signed out. With the session cookie present
  // and /auth/self failing (a 5xx, the control plane unreachable — a dead
  // session would already have been sent to /login by the refresh path), the
  // page used to show the logged-out copy and "Back to sign in", which /login
  // forwards straight back into Monitor: the loop this page exists to break.
  const checkFailed = !isLoading && !user && hasSession === true;

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
        <h1 className="text-2xl font-semibold text-primary">Access denied</h1>
        <p className="max-w-md text-sm text-secondary">
          {user ? (
            <>
              You&apos;re signed in as{" "}
              <span className="font-medium text-primary">{user.email}</span>
              {user.role ? <> ({user.role})</> : null}, and that account doesn&apos;t have
              permission for what you tried. Ask an administrator to change your role, or
              sign in with a different account.
            </>
          ) : checkFailed ? (
            <>
              Your account doesn&apos;t have permission for what you tried, and Monitor
              couldn&apos;t confirm which account you&apos;re signed in as. Try again, or sign
              out and sign in with a different account.
            </>
          ) : (
            <>
              Your account isn&apos;t authorized to do that in Monitor. Ask an administrator
              to grant you access, then sign in again.
            </>
          )}
        </p>
      </div>
      {/* Nothing until the session check settles, so a signed-in user never
          sees "Back to sign in" flash before their real options. */}
      {/* min-h holds the row's height while the check runs, so the buttons do
          not push in under the text. */}
      <div className="flex min-h-10 flex-col-reverse items-center gap-3 sm:flex-row">
      {!isLoading && hasSession !== null && (
        <>
          {user ? (
            <>
              <Link
                href="/"
                className="inline-flex h-10 items-center justify-center rounded-lg px-5 text-sm font-medium text-secondary hover:bg-surface-elevated hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Back to Monitor
              </Link>
              <Button size="lg" onClick={() => logout()}>
                Sign out and use another account
              </Button>
            </>
          ) : checkFailed ? (
            <>
              {/* A full reload re-runs AuthProvider's session check. */}
              <Button variant="secondary" size="lg" onClick={() => window.location.reload()}>
                Try again
              </Button>
              {/* logout() ignores its own result, so it works with the
                  account check down. */}
              <Button size="lg" onClick={() => logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Back to sign in
            </Link>
          )}
        </>
      )}
      </div>
    </main>
  );
}
