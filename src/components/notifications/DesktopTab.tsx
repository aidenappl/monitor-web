"use client";

import { useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faBellSlash, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import type { AlertPriority } from "@/types";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { INPUT_CLASS } from "./notifications.helpers";
import {
    getDesktopNotificationPrefs,
    setDesktopNotificationPrefs,
    sendTestDesktopNotification,
    DEFAULT_DESKTOP_PREFS,
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

    const prefs = useSyncExternalStore(subscribeDesktopSettings, getDesktopNotificationPrefs, () => DEFAULT_DESKTOP_PREFS);

    const handleTest = () => {
        if (sendTestDesktopNotification()) {
            toast.success("Test notification sent — if nothing appeared, check your OS notification settings for this browser");
        } else {
            toast.error("Browser permission is not granted, so no notification can be shown");
        }
    };

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
                            <div className="p-4 sm:p-6 space-y-6">
                                <div>
                                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                                        Desktop Notifications
                                    </h2>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Receive browser notifications when alerts fire or resolve. Notifications are delivered via the Browser Notification API and require permission.
                                    </p>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <FontAwesomeIcon
                                            icon={desktopEnabled ? faBell : faBellSlash}
                                            className={`text-lg h-[1em] w-[1em] ${desktopEnabled ? "text-blue-500" : "text-zinc-400"}`}
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
                                        className={`self-start sm:self-auto px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                                            desktopEnabled
                                                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                                                : "bg-blue-600 text-white hover:bg-blue-700"
                                        }`}
                                    >
                                        {desktopEnabled ? "Disable" : "Enable"}
                                    </button>
                                </div>

                                {/* These used to be a static list styled like settings
                                    rows, with nothing to change. Now they are the settings,
                                    stored per browser beside the on/off switch. */}
                                <fieldset disabled={!desktopEnabled} className="disabled:opacity-60">
                                    <legend className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                                        Events that trigger notifications
                                    </legend>
                                    <div className="space-y-2">
                                        {([
                                            { key: "firing", event: "Alert Firing", desc: "When an alert rule threshold is breached" },
                                            { key: "resolved", event: "Alert Resolved", desc: "When a firing alert returns to normal" },
                                        ] as const).map(({ key, event, desc }) => (
                                            <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
                                                <div className="min-w-0">
                                                    <p id={`desktop-${key}-label`} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{event}</p>
                                                    <p className="text-xs text-zinc-400">{desc}</p>
                                                </div>
                                                <Switch
                                                    checked={prefs[key]}
                                                    onChange={(checked) => setDesktopNotificationPrefs({ ...prefs, [key]: checked })}
                                                    disabled={!desktopEnabled}
                                                    labelledBy={`desktop-${key}-label`}
                                                />
                                            </div>
                                        ))}
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/30">
                                            <div className="min-w-0">
                                                <label htmlFor="desktop-min-priority" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                                    Minimum priority
                                                </label>
                                                <p className="text-xs text-zinc-400">Quieter rules than this stay off your desktop</p>
                                            </div>
                                            <select
                                                id="desktop-min-priority"
                                                value={prefs.minPriority}
                                                onChange={(e) => setDesktopNotificationPrefs({ ...prefs, minPriority: e.target.value as AlertPriority })}
                                                className={`${INPUT_CLASS} sm:w-56`}
                                            >
                                                <option value="P0">P0 Critical only</option>
                                                <option value="P1">P1 High and above</option>
                                                <option value="P2">P2 Medium and above</option>
                                                <option value="P3">All priorities</option>
                                            </select>
                                        </div>
                                    </div>
                                </fieldset>

                                <div className="flex flex-wrap items-center gap-3">
                                    <Button variant="secondary" size="sm" onClick={handleTest} disabled={notifPermission !== "granted"}>
                                        <FontAwesomeIcon icon={faPaperPlane} className="text-xs h-[1em] w-[1em]" aria-hidden="true" />
                                        Send test desktop notification
                                    </Button>
                                    {notifPermission !== "granted" && (
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Enable notifications first to send a test.</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
    );
}
