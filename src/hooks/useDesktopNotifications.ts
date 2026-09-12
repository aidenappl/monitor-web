"use client";

import { useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import type { AlertNotificationEvent } from "@/types";
import { withProject, withZone } from "@/tools/routing.tools";
import { useScope } from "@/hooks/useScope";
import { MAX_STREAM_ATTEMPTS, probeStreamRefusal } from "@/tools/stream.tools";

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
    // ⚠️ The SECOND EventSource in the app, and the one most likely to be missed
    // when the project scope changes: it is opened by a hook rather than by a
    // page, so nothing about the call site says "this is a scoped stream".
    // EventSource cannot send headers, so — like the live tail — the selector
    // has to be spliced into the URL by hand; axios interceptors never see it.
    //
    // Read reactively so switching projects tears the stream down and reopens it
    // against the new selection, rather than leaving it bound to whichever
    // project the page happened to load under.
    //
    // ⚠️ THE SELECTOR IS CARRIED BUT NOT YET HONOURED, and saying so here is the
    // point — a comment that claimed scoping this stream does not have would be
    // the decoration the next reader trusts. monitor-core's HandleStreamAlerts
    // calls AlertHub.Subscribe() with NO filters, and an AlertEvent carries no
    // project at all, so today every subscriber receives every rule's state
    // changes. That is consistent rather than accidental: timer-driven alert
    // evaluation is zone-wide by decision (see the KNOWN GAP header on
    // monitor-core's alerts/evaluator.go), so there is no per-project alert to
    // filter to. The param is sent anyway because it costs nothing, it is
    // validated on arrival — a retired slug 400s the stream rather than opening
    // a wrongly-labelled one — and because the day alert_rules gains a project
    // column, the client half is already correct.
    //
    // Scope comes from `ScopeBoundary` rather than from `useSearchParams`
    // directly. The value is identical; what changes is that a scope change now
    // REMOUNTS the calling page, so this hook is torn down and re-run wholesale
    // instead of relying on a dependency array to notice. `useScope` also throws
    // if this hook is ever called from outside `/[zone]`, which is the mistake it
    // is most exposed to: it is opened by a hook rather than by a page, so
    // nothing about the call site says "this is a scoped stream".
    const { zone, project } = useScope();
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Reconnect attempts since the last successful open. */
    const attemptsRef = useRef(0);
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
        attemptsRef.current = 0;

        const url = withZone(withProject("/api/alert-stream", project), zone);

        function connect() {
            if (disposed) return;

            const es = new EventSource(url);
            eventSourceRef.current = es;

            es.onopen = () => {
                attemptsRef.current = 0;
            };

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
                if (disposed || !getDesktopNotificationsEnabled()) return;

                // ⚠️ THE WORST OF THE TWO SILENT LOOPS, because this one has no
                // page to be wrong on. Against an unroutable zone the proxy
                // refuses with a 502 that EventSource cannot read, so this
                // reconnected every five seconds FOREVER while the operator —
                // who had deliberately turned desktop alerts on — was told
                // nothing at all and believed they were covered.
                //
                // Bounded, then said out loud. A toast is the only surface a
                // hook has, and being told once that alerts are not arriving is
                // the entire difference between this and the previous
                // behaviour.
                if (attemptsRef.current >= MAX_STREAM_ATTEMPTS) {
                    void probeStreamRefusal(url).then((found) => {
                        if (disposed) return;
                        toast.error(
                            found?.message ??
                                `Desktop alerts stopped: the alert stream for zone “${zone}” dropped ${MAX_STREAM_ATTEMPTS} times in a row.`,
                            { id: `alert-stream-${zone}`, duration: 8000 },
                        );
                    });
                    return;
                }

                attemptsRef.current += 1;
                reconnectTimerRef.current = setTimeout(connect, 5000);
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
    }, [handleAlertEvent, project, zone]);
}
