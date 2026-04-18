"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { FortaUser, UserContext } from "@/context/UserContext";

export function AppInitializer({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [user, setUser] = useState<FortaUser | null>(null);
    const [ready, setReady] = useState(false);

    // Skip auth check on public pages (e.g. /unauthorized)
    const isPublicPage = pathname === "/unauthorized";

    useEffect(() => {
        if (isPublicPage) {
            setReady(true);
            return;
        }
        const init = async () => {
            try {
                const res = await fetch("/api/monitor/self");
                if (!res.ok) {
                    const api = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");
                    // 403 with error_code 4003 means grant was revoked
                    if (res.status === 403) {
                        try {
                            const body = await res.json();
                            if (body?.error_code === 4003) {
                                window.location.href = "/unauthorized";
                                return;
                            }
                        } catch {
                            // JSON parse failed — fall through to default redirect
                        }
                    }
                    window.location.href = `${api}/forta/login`;
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    setUser(data.data);
                } else {
                    const api = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");
                    window.location.href = `${api}/forta/login`;
                    return;
                }
            } catch {
                const api = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");
                window.location.href = `${api}/forta/login`;
                return;
            }
            setReady(true);
        };
        init();
    }, [isPublicPage]);

    if (!ready) {
        return (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--background)] gap-6">
                <div className="flex items-center gap-2">
                    <Image
                        src="/Monitor-Logo-Transparent.svg"
                        alt="Monitor"
                        width={48}
                        height={48}
                        priority
                    />
                    <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        Monitor
                    </span>
                </div>
                <FontAwesomeIcon
                    icon={faSpinner}
                    className="text-zinc-400 animate-spin"
                    style={{ width: 24, height: 24 }}
                />
            </div>
        );
    }

    return (
        <UserContext.Provider value={user}>
            {children}
        </UserContext.Provider>
    );
}
