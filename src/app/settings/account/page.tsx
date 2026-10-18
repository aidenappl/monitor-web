"use client";

import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faKey, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { useZoneHref } from "@/hooks/useZoneHref";
import { useAuth } from "@/store/hooks";

const linkCard =
    "flex items-center gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-4 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/** Who you are, and the way into the pages that change it. */
export default function AccountPage() {
    const { user } = useAuth();
    const zoned = useZoneHref();

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Account</h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Who you are signed in as, and where the rest of your settings live.</p>
            </div>
            <div className="space-y-4">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4">
                    <div className="min-w-0">
                        <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Signed in as
                        </dt>
                        <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100 truncate" title={user?.email}>
                            {user?.email ?? "—"}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Role
                        </dt>
                        <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100 capitalize">
                            {user?.role ?? "—"}
                        </dd>
                    </div>
                </dl>

                <Link href="/settings/security" className={linkCard}>
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                        <FontAwesomeIcon icon={faShieldHalved} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            Sign-in &amp; security
                        </span>
                        <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                            Linked sign-in accounts and your password.
                        </span>
                    </span>
                    <FontAwesomeIcon icon={faChevronRight} className="text-xs text-zinc-400" aria-hidden />
                </Link>

                <Link href={zoned("/settings/api-keys")} className={linkCard}>
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                        <FontAwesomeIcon icon={faKey} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            API keys
                        </span>
                        <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                            Keys belong to a project inside a zone, so they live in that
                            zone&apos;s settings. This opens the zone you were last in.
                        </span>
                    </span>
                    <FontAwesomeIcon icon={faChevronRight} className="text-xs text-zinc-400" aria-hidden />
                </Link>
            </div>
        </div>
    );
}

