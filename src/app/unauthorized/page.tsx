"use client";

import Image from "next/image";

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 rounded-xl p-8 shadow-sm border border-zinc-200 dark:border-zinc-800 max-w-md w-full text-center">
        <div className="flex items-center justify-center gap-3">
          <Image
            src="/Monitor-Logo-Transparent.svg"
            alt="Monitor"
            width={40}
            height={40}
            className="h-10 w-10"
            priority
          />
          <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600" />
          <span className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            Forta
          </span>
        </div>

        <div className="mt-6 flex justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-10 h-10 text-zinc-400 dark:text-zinc-500"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16" r="1" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-zinc-900 dark:text-white mt-4">
          Unauthorized
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
          You don&apos;t have access to Monitor. Your grant may have been
          revoked or you haven&apos;t been granted access yet.
        </p>

        <a
          href="https://forta.appleby.cloud"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors mt-6"
        >
          Go to Forta Dashboard
        </a>
        <a
          href="https://forta.appleby.cloud"
          className="w-full inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-colors mt-2"
        >
          Sign in with a different account
        </a>

        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-6">
          If you believe this is a mistake, contact your administrator.
        </p>
      </div>
    </main>
  );
}
