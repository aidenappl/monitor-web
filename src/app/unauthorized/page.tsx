"use client";

import Image from "next/image";
import Link from "next/link";
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
export default function Page() {
  const { logout } = useAuthContext();
  const { user, isLoading } = useAuth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <Image
        src="/Monitor-Logo-Dark.svg"
        alt="Monitor"
        width={48}
        height={48}
        className="h-12 w-12 rounded-xl shadow-md"
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
      {!isLoading && (
        <div className="flex flex-col-reverse items-center gap-3 sm:flex-row">
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
          ) : (
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Back to sign in
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
