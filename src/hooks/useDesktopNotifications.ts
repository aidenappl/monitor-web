"use client";

import { useEffect, useRef, useCallback } from "react";
import type { AlertNotificationEvent } from "@/types";

const STORAGE_KEY = "monitor-desktop-notifications-enabled";

export function getDesktopNotificationsEnabled(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setDesktopNotificationsEnabled(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY, String(enabled));
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
    if (typeof Notification === "undefined") return Promise.resolve("denied" as NotificationPermission);
    return Notification.requestPermission();
}

export function getNotificationPermission(): NotificationPermission {
    if (typeof Notification === "undefined") return "denied";
    return Notification.permission;
}

export function useDesktopNotifications(): void {
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const permissionRef = useRef<NotificationPermission>(
        typeof Notification !== "undefined" ? Notification.permission : "default",
    );

    useEffect(() => {
        if (typeof Notification !== "undefined") {
            permissionRef.current = Notification.permission;
        }
    }, []);

    const handleAlertEvent = useCallback((event: AlertNotificationEvent) => {
        if (!getDesktopNotificationsEnabled()) return;
        if (permissionRef.current !== "granted") return;
        if (typeof Notification === "undefined") return;

        const isFiring = event.status === "firing";
        const title = isFiring
            ? `Alert Firing: ${event.rule_name}`
            : `Alert Resolved: ${event.rule_name}`;

        new Notification(title, {
            body: event.message,
            icon: "/favicon.ico",
            tag: `monitor-alert-${event.rule_id}-${event.status}`,
            silent: false,
        });
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!getDesktopNotificationsEnabled()) return;

        let disposed = false;

        function connect() {
            if (disposed) return;

            const es = new EventSource("/api/alert-stream");
            eventSourceRef.current = es;

            es.onmessage = (msg) => {
                try {
                    const data = JSON.parse(msg.data) as AlertNotificationEvent;
                    handleAlertEvent(data);
                } catch {
                    // ignore malformed events
                }
            };

            es.onerror = () => {
                es.close();
                eventSourceRef.current = null;
                if (!disposed && getDesktopNotificationsEnabled()) {
                    reconnectTimerRef.current = setTimeout(connect, 5000);
                }
            };
        }

        connect();

        return () => {
            disposed = true;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
        };
    }, [handleAlertEvent]);
}
