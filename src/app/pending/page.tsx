"use client";

import Image from "next/image";
import { useAuthContext } from "@/context/AuthContext";
import { useAuth } from "@/store/hooks";
import { Button } from "@/components/ui/button";

// Shown when the API returns 403 error_code 4004 — an authenticated account whose
// role is still "pending" (freshly SSO-provisioned, awaiting admin approval).
export default function Page() {
  const { logout } = useAuthContext();
  const { user } = useAuth();

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
        <h1 className="text-2xl font-semibold text-primary">Account pending approval</h1>
        <p className="max-w-md text-sm text-secondary">
          {user?.email ? (
            <>
              Your account <span className="font-medium text-primary">{user.email}</span> has
              been created
            </>
          ) : (
            "Your account has been created"
          )}{" "}
          and is waiting for an administrator to grant you access. You&apos;ll be able to sign
          in once it&apos;s approved.
        </p>
      </div>
      <Button variant="secondary" size="lg" onClick={() => logout()}>
        Sign out
      </Button>
    </main>
  );
}
