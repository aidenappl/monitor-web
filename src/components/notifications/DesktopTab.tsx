"use client";

import { useSyncExternalStore } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faBellSlash } from "@fortawesome/free-solid-svg-icons";
import {
    getDesktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    requestNotificationPermission,
    getNotificationPermission,
    subscribeDesktopSettings,
} from "@/hooks/useDesktopNotifications";

export function DesktopTab() {
    const desktopEnabled = useSyncExternalStore(subscribeDesktopSettings, getDesktopNotificationsEnabled, () => false);
    const notifPermission = useSyncExternalStore<NotificationPermission>(
        subscribeDesktopSettings,
        getNotificationPermission,
        () => "default",
    );

    const handleToggleDesktop = async () => {
        if (!desktopEnabled && notifPermission !== "granted") {
            const perm = await requestNotificationPermission();
            if (perm !== "granted") return;
        }
        const next = !desktopEnabled;
        setDesktopNotificationsEnabled(next);
    };

    return (
                    <div className="space-y-4">
                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            <div className="p-6 space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                                        Desktop Notifications
                                    </h3>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Receive browser notifications when alerts fire or resolve. Notifications are delivered via the Browser Notification API and require permission.
                                    </p>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <FontAwesomeIcon
                                            icon={desktopEnabled ? faBell : faBellSlash}
                                            className={`text-lg ${desktopEnabled ? "text-blue-500" : "text-zinc-400"}`}
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                {desktopEnabled ? "Notifications enabled" : "Notifications disabled"}
                                            </p>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                {notifPermission === "granted"
                                                    ? "Browser permission granted"
                                                    : notifPermission === "denied"
                                                      ? "Browser permission denied — update in browser settings"
                                                      : "Browser permission not yet requested"}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleToggleDesktop}
                                        disabled={notifPermission === "denied"}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                                            desktopEnabled
                                                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                                                : "bg-blue-600 text-white hover:bg-blue-700"
                                        }`}
                                    >
                                        {desktopEnabled ? "Disable" : "Enable"}
                                    </button>
                                </div>

                                <div>
                                    <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                                        Events that trigger notifications
                                    </h4>
                                    <div className="space-y-2">
                                        {[
                                            { event: "Alert Firing", desc: "When an alert rule threshold is breached" },
                                            { event: "Alert Resolved", desc: "When a firing alert returns to normal" },
                                        ].map(({ event, desc }) => (
                                            <div key={event} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
                                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{event}</span>
                                                <span className="text-xs text-zinc-400">{desc}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
    );
}
