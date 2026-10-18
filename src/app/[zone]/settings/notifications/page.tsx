"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { reportError } from "@/services/monitor.service";
import { NotificationPolicy, ServiceGroup, NotificationChannelWithTest, AlertRule } from "@/types";
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
import { FlowSummary } from "@/components/notifications/FlowSummary";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useUrlState, urlEnum } from "@/hooks/useUrlState";

const TAB_IDS = ["policies", "service-groups", "channels", "desktop"] as const;
type TabId = (typeof TAB_IDS)[number];
const tabCodec = urlEnum(TAB_IDS);

const tabs: { id: TabId; label: ReactNode }[] = [
    { id: "policies", label: "Policies" },
    // Shortened on phones: at 375px the full label pushed "Desktop" out of view.
    {
        id: "service-groups",
        label: (
            <>
                <span className="sm:hidden">Groups</span>
                <span className="hidden sm:inline">Service Groups</span>
            </>
        ),
    },
    { id: "channels", label: "Channels" },
    { id: "desktop", label: "Desktop" },
];

// ─── Main Page ───

function Notifications() {
    // In the URL (?tab=channels), so a reload after a channel test, Back, and a
    // link pasted to a teammate all land on the same tab.
    const [activeTab, setActiveTab] = useUrlState("tab", tabCodec, { default: "policies" });

    // Alert rules (for connected alerts count, and desktop alerts' priority filter)
    const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
    const priorityByRule = useMemo(() => new Map(alertRules.map((r) => [r.id, r.priority])), [alertRules]);
    const priorityOf = useCallback((ruleId: string) => priorityByRule.get(ruleId), [priorityByRule]);

    // Desktop notifications
    useDesktopNotifications(priorityOf);

    // Policies
    const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
    const [policiesLoading, setPoliciesLoading] = useState(true);
    const [policiesError, setPoliciesError] = useState<string | null>(null);

    // Service Groups
    const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
    const [serviceGroupsLoading, setServiceGroupsLoading] = useState(true);
    const [serviceGroupsError, setServiceGroupsError] = useState<string | null>(null);

    // Channels
    const [channels, setChannels] = useState<NotificationChannelWithTest[]>([]);
    // true from the first render: false showed "No notification channels" for
    // a frame before the read had even started.
    const [channelsLoading, setChannelsLoading] = useState(true);
    const [channelsError, setChannelsError] = useState<string | null>(null);

    // Channel health indicators
    const [testedChannels, setTestedChannels] = useState<TestedChannels>(new Map());

    const [alertRulesError, setAlertRulesError] = useState<string | null>(null);
    const [alertRulesLoading, setAlertRulesLoading] = useState(true);

    // ─── Fetchers ───

    // Each list is read by its own effect, re-run by bumping its token. The
    // fetch* functions the tabs call after a write only raise the loading flag
    // and bump the token: the read itself lives in the effect, so its cleanup
    // cancels a superseded read rather than letting it land over a newer one.
    const [policiesToken, setPoliciesToken] = useState(0);
    const [serviceGroupsToken, setServiceGroupsToken] = useState(0);
    const [channelsToken, setChannelsToken] = useState(0);
    const [alertRulesToken, setAlertRulesToken] = useState(0);

    const fetchPolicies = useCallback(() => {
        setPoliciesLoading(true);
        setPoliciesToken((t) => t + 1);
    }, []);
    const fetchServiceGroups = useCallback(() => {
        setServiceGroupsLoading(true);
        setServiceGroupsToken((t) => t + 1);
    }, []);
    const fetchChannels = useCallback(() => {
        setChannelsLoading(true);
        setChannelsToken((t) => t + 1);
    }, []);
    // No loading flag raised: a re-read keeps the match counts on screen.
    const fetchAlertRules = useCallback(() => setAlertRulesToken((t) => t + 1), []);

    // ⚠️ This page decides who gets woken up. Every list below used to collapse
    // a failed request into an empty array, so a 500 rendered "No policies —
    // alerts will not be routed anywhere" and "No notification channels". Both
    // are claims about the configuration, and both are the opposite of what a
    // failed read actually establishes.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await reqListPolicies();
                if (cancelled) return;
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
                if (!cancelled) setPoliciesError("Failed to load policies");
            } finally {
                if (!cancelled) setPoliciesLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [policiesToken]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await reqListServiceGroups();
                if (cancelled) return;
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
                if (!cancelled) setServiceGroupsError("Failed to load service groups");
            } finally {
                if (!cancelled) setServiceGroupsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [serviceGroupsToken]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await reqListNotificationChannels();
                if (cancelled) return;
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
                if (!cancelled) setChannelsError("Failed to load channels");
            } finally {
                if (!cancelled) setChannelsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [channelsToken]);

    // Rules only feed the "which rules match this policy" preview, so this one
    // degrades IN PLACE — a separate flag, deliberately, because folding it into
    // policiesError would blank a perfectly good policy list over a missing
    // preview. Partial failures get a note; total ones get the panel.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await reqListAlertRules();
                if (cancelled) return;
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
                if (!cancelled) setAlertRulesError("Failed to load alert rules");
            } finally {
                if (!cancelled) setAlertRulesLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [alertRulesToken]);

    return (
        <div>
            <div className="space-y-4 sm:space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Notification routing
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Where a firing alert rule goes: policies, service groups and delivery
                        channels. The rules themselves are on the Alerts page.
                    </p>
                </div>

                <FlowSummary
                    rules={alertRules}
                    policies={policies}
                    channels={channels}
                    loading={alertRulesLoading || policiesLoading || channelsLoading}
                    failed={{ rules: Boolean(alertRulesError), policies: Boolean(policiesError), channels: Boolean(channelsError) }}
                    onOpenTab={setActiveTab}
                />

                <Tabs
                    id="notifications"
                    label="Notification sections"
                    items={tabs}
                    value={activeTab}
                    onChange={setActiveTab}
                    // Tighter tabs on phones so all four fit at 375px.
                    className="[&_[role=tab]]:px-3 sm:[&_[role=tab]]:px-4"
                />

                <TabPanel tabsId="notifications" value={activeTab}>
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
                            alertRules={alertRules}
                            testedChannels={testedChannels}
                            setTestedChannels={setTestedChannels}
                        />
                    )}
                    {activeTab === "desktop" && <DesktopTab />}
                </TabPanel>
            </div>
        </div>
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
