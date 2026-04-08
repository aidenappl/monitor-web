"use client";

import { useState, useEffect, useRef } from "react";

interface FortaUser {
    id: number;
    name: string | null;
    display_name: string | null;
    email: string;
    profile_image_url: string | null;
}

export function UserMenu() {
    const [user, setUser] = useState<FortaUser | null>(null);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch("/api/monitor/self")
            .then((r) => r.json())
            .then((d) => {
                if (d.success) setUser(d.data);
            })
            .catch(() => {});
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, []);

    if (!user) return null;

    const displayName = user.display_name || user.name || user.email;
    const initials = displayName.slice(0, 2).toUpperCase();

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                aria-label="User menu"
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
                {user.profile_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={user.profile_image_url}
                        alt={displayName}
                        className="w-7 h-7 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-zinc-700"
                    />
                ) : (
                    <div className="w-7 h-7 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white text-xs font-semibold select-none">
                        {initials}
                    </div>
                )}
                <span className="hidden sm:block text-sm font-medium text-zinc-700 dark:text-zinc-300 max-w-[120px] truncate">
                    {displayName}
                </span>
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg z-50 py-1 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {displayName}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                            {user.email}
                        </p>
                    </div>
                    <a
                        href={`${process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080"}/forta/logout`}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setOpen(false)}
                    >
                        Sign out
                    </a>
                </div>
            )}
        </div>
    );
}
