"use client";

import Image from "next/image";
import { useAuthContext } from "@/context/AuthContext";

// Shown when the API returns 403 error_code 4004 — an authenticated account whose
// role is still "pending" (freshly SSO-provisioned, awaiting admin approval).
export default function Page() {
  const { logout } = useAuthContext();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Image
        src="/Monitor-Logo-Dark.svg"
        alt="Monitor"
        width={48}
        height={48}
        className="h-12 w-12"
        priority
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Account pending approval</h1>
        <p className="max-w-md text-sm text-neutral-400">
          Your account has been created and is waiting for an administrator to
          grant you access. You&apos;ll be able to sign in once it&apos;s approved.
        </p>
      </div>
      <button
        onClick={() => logout()}
        className="rounded-md border border-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-900"
      >
        Sign out
      </button>
    </div>
  );
}
