"use client";

import Image from "next/image";
import Link from "next/link";

// Shown when the API returns 403 error_code 4003 (authenticated but not granted
// access to Monitor). Locally built — no external auth SDK.
export default function Page() {
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
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="max-w-md text-sm text-neutral-400">
          Your account isn&apos;t authorized to use Monitor. Ask an administrator
          to grant you access, then sign in again.
        </p>
      </div>
      <Link
        href="/login"
        className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700"
      >
        Back to sign in
      </Link>
    </div>
  );
}
