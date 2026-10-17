"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { reportError } from "@/services/monitor.service";
import { NotificationPolicy, ServiceGroup, NotificationChannel, AlertRule } from "@/types";
import {
    reqListPolicies,
    reqListServiceGroups,
    reqListNotificationChannels,
    reqListAlertRules,
} from "@/services/api";
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";
import { PoliciesTab } from "@/components/notifications/PoliciesTab";
import { ServiceGroupsTab } from "@/components/notifications/ServiceGroupsTab";
import { ChannelsTab, type TestedChannels } from "@/components/notifications/ChannelsTab";
import { DesktopTab } from "@/components/notifications/DesktopTab";

type TabId = "policies" | "service-groups" | "channels" | "desktop";

const tabs: { id: TabId; label: string }[] = [
    { id: "policies", label: "Policies" },
    { id: "service-groups", label: "Service Groups" },
    { id: "channels", label: "Channels" },
    { id: "desktop", label: "Desktop" },
];

// ─── Main Page ───

function Notifications() {
    const [activeTab, setActiveTab] = useState<TabId>("policies");

    // Desktop notifications
    useDesktopNotifications();

    // Policies
    const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
    const [policiesLoading, setPoliciesLoading] = useState(true);
    const [policiesError, setPoliciesError] = useState<string | null>(null);

    // Service Groups
    const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
    const [serviceGroupsLoading, setServiceGroupsLoading] = useState(true);
    const [serviceGroupsError, setServiceGroupsError] = useState<string | null>(null);

    // Channels
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    const [channelsLoading, setChannelsLoading] = useState(false);
    const [channelsError, setChannelsError] = useState<string | null>(null);

    // Channel health indicators
    const [testedChannels, setTestedChannels] = useState<TestedChannels>(new Map());

    // Alert rules (for connected alerts count)
    const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
    const [alertRulesError, setAlertRulesError] = useState<string | null>(null);

    // ─── Fetchers ───

    // ⚠️ This page decides who gets woken up. Every list below used to collapse
    // a failed request into an empty array, so a 500 rendered "No policies —
    // alerts will not be routed anywhere" and "No notification channels". Both
    // are claims about the configuration, and both are the opposite of what a
    // failed read actually establishes.
    const fetchPolicies = useCallback(async () => {
        setPoliciesLoading(true);
        try {
            const res = await reqListPolicies();
            if (!res.success) {
                setPoliciesError(res.error_message || "The request failed.");
                return;
            }
            setPoliciesError(null);
            const data = res.data;
            data.sort((a, b) => a.position - b.position);
            setPolicies(data);
        } catch (err) {
            reportError("notification_policy.list.failed", err, {
                outcome: "policy list shows its failure state",
            });
            setPoliciesError("Failed to load policies");
        } finally {
            setPoliciesLoading(false);
        }
    }, []);

    const fetchServiceGroups = useCallback(async () => {
        setServiceGroupsLoading(true);
        try {
            const res = await reqListServiceGroups();
            if (!res.success) {
                setServiceGroupsError(res.error_message || "The request failed.");
                return;
            }
            setServiceGroupsError(null);
            setServiceGroups(res.data);
        } catch (err) {
            reportError("service_group.list.failed", err, {
                outcome: "service groups show their failure state",
            });
            setServiceGroupsError("Failed to load service groups");
        } finally {
            setServiceGroupsLoading(false);
        }
    }, []);

    const fetchChannels = useCallback(async () => {
        setChannelsLoading(true);
        try {
            const res = await reqListNotificationChannels();
            if (!res.success) {
                setChannelsError(res.error_message || "The request failed.");
                return;
            }
            setChannelsError(null);
            setChannels(res.data);
        } catch (err) {
            reportError("notification_channel.list.failed", err, {
                outcome: "channel list shows its failure state",
            });
            setChannelsError("Failed to load channels");
        } finally {
            setChannelsLoading(false);
        }
    }, []);

    // Rules only feed the "which rules match this policy" preview, so this one
    // degrades IN PLACE — a separate flag, deliberately, because folding it into
    // policiesError would blank a perfectly good policy list over a missing
    // preview. Partial failures get a note; total ones get the panel.
    const fetchAlertRules = useCallback(async () => {
        try {
            const res = await reqListAlertRules();
            if (!res.success) {
                setAlertRulesError(res.error_message || "The request failed.");
                return;
            }
            setAlertRulesError(null);
            setAlertRules(res.data);
        } catch (err) {
            reportError("alert_rule.list.failed", err, {
                outcome: "policy match counts show a failure note",
            });
            setAlertRulesError("Failed to load alert rules");
        }
    }, []);

    useEffect(() => {
        fetchPolicies();
        fetchServiceGroups();
        fetchChannels();
        fetchAlertRules();
    }, [fetchPolicies, fetchServiceGroups, fetchChannels, fetchAlertRules]);

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Notification Center
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Configure notification policies, service groups, and delivery channels.
                    </p>
                </div>

                {/* Tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-700">
                    <nav className="flex gap-1 -mb-px">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                                        : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {activeTab === "policies" && (
                    <PoliciesTab
                        policies={policies}
                        setPolicies={setPolicies}
                        policiesLoading={policiesLoading}
                        policiesError={policiesError}
                        fetchPolicies={fetchPolicies}
                        serviceGroups={serviceGroups}
                        channels={channels}
                        alertRules={alertRules}
                        alertRulesError={alertRulesError}
                        fetchAlertRules={fetchAlertRules}
                    />
                )}
                {activeTab === "service-groups" && (
                    <ServiceGroupsTab
                        serviceGroups={serviceGroups}
                        serviceGroupsLoading={serviceGroupsLoading}
                        serviceGroupsError={serviceGroupsError}
                        fetchServiceGroups={fetchServiceGroups}
                        policies={policies}
                    />
                )}
                {activeTab === "channels" && (
                    <ChannelsTab
                        channels={channels}
                        channelsLoading={channelsLoading}
                        channelsError={channelsError}
                        fetchChannels={fetchChannels}
                        policies={policies}
                        testedChannels={testedChannels}
                        setTestedChannels={setTestedChannels}
                    />
                )}
                {activeTab === "desktop" && <DesktopTab />}
            </div>
        </main>
    );
}

export default function NotificationsPage() {
    // useDesktopNotifications reads the ?project selector, and useSearchParams
    // requires a Suspense boundary during static generation.
    return (
        <Suspense fallback={null}>
            <Notifications />
        </Suspense>
    );
}
