"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import {
    AlertRule,
    AlertHistoryEntry,
    NotificationPolicy,
    NotificationChannel,
    ServiceGroup,
    AlertPriority,
    PRIORITY_LABELS,
} from "@/types";
import {
    reqListAlertRules,
    reqCreateAlertRule,
    reqUpdateAlertRule,
    reqDeleteAlertRule,
    reqTestAlertRule,
    reqListAlertHistory,
    reqListPolicies,
    reqListNotificationChannels,
    reqListServiceGroups,
} from "@/services/api";
import { FailureState, FailureNote } from "@/components/FailureState";
import { SkeletonRows } from "@/components/ui/skeleton";
import { RefetchBar } from "@/components/ui/spinner";
import { reportError } from "@/services/monitor.service";
import { useZoneHref } from "@/hooks/useZoneHref";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { Tabs, TabPanel, type TabItem } from "@/components/ui/tabs";
import { Segmented } from "@/components/ui/segmented";
import { useUrlState, urlEnum, urlString } from "@/hooks/useUrlState";
import { RuleFormModal, RuleFormData, ruleToForm, formToPayload, NAME_MAX } from "@/components/alerts/RuleFormModal";
import { RuleRow, TestOutcome } from "@/components/alerts/RuleRow";
import { AlertHistoryTab } from "@/components/alerts/AlertHistoryTab";
import { AlertRuleRow, describeFilter, parseFilters, previewRouting } from "@/components/alerts/alerts.tools";

type TabId = "rules" | "history";

const tabs: TabItem<TabId>[] = [
    { id: "rules", label: "Rules" },
    { id: "history", label: "History" },
];
const tabCodec = urlEnum<TabId>(["rules", "history"]);


type StateFilter = "all" | "firing" | "enabled" | "disabled";
const stateCodec = urlEnum<StateFilter>(["all", "firing", "enabled", "disabled"]);
const STATE_OPTIONS = (["all", "firing", "enabled", "disabled"] as const).map((v) => ({
    value: v,
    label: v.charAt(0).toUpperCase() + v.slice(1),
}));

const HISTORY_PAGE_SIZE = 100;

/** "X (copy)", then "X (copy 2)"… — a second copy with the same name is refused server-side. */
function copyName(name: string, existing: Set<string>): string {
    const base = name.replace(/ \(copy(?: \d+)?\)$/, "");
    for (let n = 1; ; n++) {
        const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
        const candidate = base.slice(0, NAME_MAX - suffix.length) + suffix;
        if (!existing.has(candidate)) return candidate;
    }
}

export default function AlertsPage() {
    const zoned = useZoneHref();
    // In the URL, so a reload, Back or a pasted link lands on the same view.
    const [activeTab, setActiveTab] = useUrlState("tab", tabCodec, { default: "rules" });
    const [ruleSearch, setRuleSearch] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
    const [ruleStateFilter, setRuleStateFilter] = useUrlState("state", stateCodec, { default: "all" });
    const [historyRuleFilter, setHistoryRuleFilter] = useUrlState("rule", urlString, { default: "" });

    // Rules
    const [rules, setRules] = useState<AlertRuleRow[]>([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [rulesError, setRulesError] = useState<string | null>(null);
    const [showRuleForm, setShowRuleForm] = useState(false);
    const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
    const [ruleSubmitting, setRuleSubmitting] = useState(false);
    const [ruleFormError, setRuleFormError] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, TestOutcome>>({});
    const [bulkBusy, setBulkBusy] = useState(false);
    // Rows with a toggle or duplicate in flight. The ref is the synchronous
    // guard (a double-click lands before the re-render); the state drives the UI.
    const busyRef = useRef(new Set<string>());
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const confirm = useConfirm();
    const { canWrite } = useRole();

    // History
    const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [knownRules, setKnownRules] = useState<Record<string, string>>({});

    // Policies, channels and service groups (for the routing preview)
    const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    const [groups, setGroups] = useState<ServiceGroup[]>([]);
    // One flag for all three: they exist only to render the routing preview, and
    // a preview built from part of the data is as misleading as one built from none.
    const [routingError, setRoutingError] = useState<string | null>(null);
    const [routingLoading, setRoutingLoading] = useState(true);

    // ⚠️ "No alert rules — create your first alert rule to get started" was what
    // a 500 rendered here. On an alerting page that is the most dangerous empty
    // state in the app: it tells an operator their monitoring is unconfigured
    // when in fact it is merely unreadable.
    const fetchRules = useCallback(async () => {
        setRulesLoading(true);
        try {
            const res = await reqListAlertRules();
            if (!res.success) {
                setRulesError(res.error_message || "The request failed.");
                return;
            }
            setRulesError(null);
            setRules(res.data);
        } catch (err) {
            reportError("alert_rule.list.failed", err, {
                outcome: "rules list shows its failure state",
            });
            setRulesError("Failed to load alert rules");
        } finally {
            setRulesLoading(false);
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await reqListAlertHistory(historyRuleFilter || undefined, historyLimit);
            // Same shape as the rules list: an empty history means "nothing has
            // fired", which is exactly the reassuring reading a failed request
            // must not be allowed to borrow.
            if (!res.success) {
                setHistoryError(res.error_message || "The request failed.");
                setHistoryHasMore(false);
                return;
            }
            setHistoryError(null);
            const rows = res.data ?? [];
            setHistory(rows);
            // Remembered across loads, so deleted rules stay in the filter.
            setKnownRules((prev) => {
                const next = { ...prev };
                for (const r of rows) next[r.rule_id] = r.rule_name;
                return next;
            });
            // History supports limit only — a full page means there may be more.
            setHistoryHasMore(rows.length === historyLimit);
        } catch (err) {
            reportError("alert_history.load.failed", err, {
                outcome: "history shows its failure state",
            });
            setHistoryError("Failed to load alert history");
        } finally {
            setHistoryLoading(false);
        }
    }, [historyRuleFilter, historyLimit]);

    // Policies, channels and groups drive the "→ Email via …" line under each
    // rule and the preview in the form. Failing them silently would read as
    // "this rule notifies nobody" — a statement about the config, not the fetch.
    const fetchRouting = useCallback(async () => {
        setRoutingLoading(true);
        try {
            const [policiesRes, channelsRes, groupsRes] = await Promise.all([
                reqListPolicies(),
                reqListNotificationChannels(),
                reqListServiceGroups(),
            ]);
            const failed = [policiesRes, channelsRes, groupsRes].find((r) => !r.success);
            if (failed && !failed.success) {
                setRoutingError(failed.error_message || "The request failed.");
                return;
            }
            setRoutingError(null);
            setPolicies(policiesRes.success ? policiesRes.data ?? [] : []);
            setChannels(channelsRes.success ? channelsRes.data ?? [] : []);
            setGroups(groupsRes.success ? groupsRes.data ?? [] : []);
        } catch (err) {
            reportError("notification_policy.list.failed", err, {
                outcome: "rule routing lines show a failure note",
            });
            setRoutingError("Failed to load notification routing");
        } finally {
            setRoutingLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRules();
        fetchRouting();
    }, [fetchRules, fetchRouting]);

    useEffect(() => {
        if (activeTab === "history") fetchHistory();
    }, [activeTab, fetchHistory]);

    const setBusy = (id: string, busy: boolean) => {
        if (busy) busyRef.current.add(id);
        else busyRef.current.delete(id);
        setBusyIds(new Set(busyRef.current));
    };

    // ⚠️ Every handler below branches on `success`. They used to announce
    // success unconditionally: the catch never fires on a non-2xx, so a rejected
    // write showed a green toast and closed the form. A failed save now keeps
    // the form open with the server's message pinned under the field it names.
    const handleCreateRule = async (data: RuleFormData) => {
        setRuleSubmitting(true);
        setRuleFormError(null);
        try {
            const res = await reqCreateAlertRule(formToPayload(data));
            if (!res.success) {
                setRuleFormError(res.error_message || "Failed to create alert rule");
                return;
            }
            setShowRuleForm(false);
            toast.success(data.enabled ? "Alert rule created and enabled" : "Alert rule created — disabled until you enable it");
            fetchRules();
        } catch (err) {
            reportError("alert_rule.create.failed", err, {
                outcome: "rule not created; error shown in the form",
            });
            setRuleFormError("Failed to create alert rule");
        } finally {
            setRuleSubmitting(false);
        }
    };

    const handleEditRule = async (data: RuleFormData) => {
        if (!editingRule) return;
        setRuleSubmitting(true);
        setRuleFormError(null);
        try {
            const res = await reqUpdateAlertRule(editingRule.id, formToPayload(data));
            if (!res.success) {
                setRuleFormError(res.error_message || "Failed to update alert rule");
                return;
            }
            setEditingRule(null);
            toast.success("Alert rule updated");
            fetchRules();
        } catch (err) {
            reportError("alert_rule.save.failed", err, {
                rule_id: editingRule?.id,
                outcome: "rule edit not saved; error shown in the form",
            });
            setRuleFormError("Failed to update alert rule");
        } finally {
            setRuleSubmitting(false);
        }
    };

    const handleDeleteRule = async (rule: AlertRule) => {
        // ⚠️ This was one unconfirmed click on a trash icon next to the edit
        // pencil — on the page that decides whether anyone gets paged.
        const ok = await confirm({
            title: <span className="[overflow-wrap:anywhere]">Delete “{rule.name}”?</span>,
            description: "The rule stops evaluating immediately and its firing state is discarded. Alert history is kept.",
            confirmLabel: "Delete rule",
            destructive: true,
        });
        if (!ok) return;
        try {
            const res = await reqDeleteAlertRule(rule.id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete alert rule");
                return;
            }
            fetchRules();
            toast.success("Alert rule deleted");
        } catch (err) {
            reportError("alert_rule.delete.failed", err, {
                rule_id: rule.id,
                outcome: "rule kept; user toasted",
            });
            toast.error("Failed to delete alert rule");
        }
    };

    const handleDuplicateRule = async (rule: AlertRule) => {
        // A second click while the first POST is in flight used to send a second
        // copy, which the server refused with a 400 after a success toast.
        if (busyRef.current.has(rule.id)) return;
        setBusy(rule.id, true);
        try {
            const res = await reqCreateAlertRule({
                // Carries notification_channel_ids: the copy keeps its fallback channels.
                ...formToPayload(ruleToForm(rule)),
                name: copyName(rule.name, new Set(rules.map((r) => r.name))),
                // A copy starts disabled: two identical enabled rules page twice.
                enabled: false,
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to duplicate the rule");
                return;
            }
            toast.success("Duplicated — the copy starts disabled");
            fetchRules();
        } catch (err) {
            reportError("alert_rule.duplicate.failed", err, {
                rule_id: rule.id,
                outcome: "no copy created; user toasted",
            });
            toast.error("Failed to duplicate the rule");
        } finally {
            setBusy(rule.id, false);
        }
    };

    // Bulk actions keep the selection (delete aside — its rows are gone), so
    // "disable, then set P3" on the same rules is two clicks, not a re-select.
    const bulkSetEnabled = async (enabled: boolean) => {
        const targets = rules.filter((r) => selection.isSelected(r.id) && r.enabled !== enabled);
        if (targets.length === 0) {
            toast(`All selected rules are already ${enabled ? "enabled" : "disabled"}`);
            return;
        }
        setBulkBusy(true);
        try {
            const result = await runBulk(targets, (r) => reqUpdateAlertRule(r.id, { enabled }));
            toastBulkResult(result, enabled ? "Enabled" : "Disabled", "rule");
        } finally {
            setBulkBusy(false);
            fetchRules();
        }
    };

    const bulkSetPriority = async (priority: AlertPriority) => {
        const targets = rules.filter((r) => selection.isSelected(r.id) && (r.priority || "P2") !== priority);
        if (targets.length === 0) {
            toast(`All selected rules are already ${priority}`);
            return;
        }
        setBulkBusy(true);
        try {
            const result = await runBulk(targets, (r) => reqUpdateAlertRule(r.id, { priority }));
            toastBulkResult(result, `Set ${priority} on`, "rule");
        } finally {
            setBulkBusy(false);
            fetchRules();
        }
    };

    const bulkDelete = async () => {
        const targets = rules.filter((r) => selection.isSelected(r.id));
        const ok = await confirm({
            title: `Delete ${targets.length} alert rule${targets.length === 1 ? "" : "s"}?`,
            description: (
                <span className="[overflow-wrap:anywhere]">
                    {targets.slice(0, 5).map((r) => r.name).join(", ")}
                    {targets.length > 5 ? ` and ${targets.length - 5} more` : ""}. They stop evaluating immediately.
                </span>
            ),
            confirmLabel: `Delete ${targets.length} rule${targets.length === 1 ? "" : "s"}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        try {
            const result = await runBulk(targets, (r) => reqDeleteAlertRule(r.id));
            toastBulkResult(result, "Deleted", "rule");
            selection.clear();
        } finally {
            setBulkBusy(false);
            fetchRules();
        }
    };

    // A test is a dry run server-side (HandleTestAlertRule evaluates and returns;
    // it routes nothing), so it needs no confirmation — but one throw used to
    // leave bulkBusy stuck true and every bulk button dead.
    const bulkTest = async () => {
        const targets = rules.filter((r) => selection.isSelected(r.id));
        setBulkBusy(true);
        setTestResults((prev) => ({ ...prev, ...Object.fromEntries(targets.map((r) => [r.id, { pending: true } as TestOutcome])) }));
        try {
            const outcomes = await Promise.all(
                targets.map(async (r): Promise<[string, TestOutcome]> => {
                    try {
                        const res = await reqTestAlertRule(r.id);
                        return [
                            r.id,
                            res.success
                                ? { value: res.data.value, would_fire: res.data.firing }
                                : { error: res.error_message || "Test failed" },
                        ];
                    } catch (err) {
                        reportError("alert_rule.test.failed", err, {
                            rule_id: r.id,
                            outcome: "test result shows its failure",
                        });
                        return [r.id, { error: "Could not test the rule" }];
                    }
                }),
            );
            const next = Object.fromEntries(outcomes);
            setTestResults((prev) => ({ ...prev, ...next }));
            const firing = outcomes.filter(([, o]) => "would_fire" in o && o.would_fire).length;
            const failed = outcomes.filter(([, o]) => "error" in o).length;
            toast(`${targets.length} tested · ${firing} would fire${failed ? ` · ${failed} failed` : ""}`);
        } finally {
            setBulkBusy(false);
        }
    };

    const handleToggleRule = async (rule: AlertRule) => {
        if (busyRef.current.has(rule.id)) return;
        setBusy(rule.id, true);
        try {
            const res = await reqUpdateAlertRule(rule.id, { enabled: !rule.enabled });
            if (!res.success) {
                toast.error(res.error_message || "Failed to toggle alert rule");
                return;
            }
            await fetchRules();
            toast.success(rule.enabled ? "Rule disabled" : "Rule enabled");
        } catch (err) {
            reportError("alert_rule.toggle.failed", err, {
                rule_id: rule.id,
                enabling: !rule.enabled,
                outcome: "rule state unchanged; user toasted",
            });
            toast.error("Failed to toggle alert rule");
        } finally {
            setBusy(rule.id, false);
        }
    };

    const handleTestRule = async (id: string) => {
        setTestResults((prev) => ({ ...prev, [id]: { pending: true } }));
        try {
            const res = await reqTestAlertRule(id);
            // A failed test used to do nothing at all — the button consumed the
            // click and no result ever appeared, which is indistinguishable from
            // a test that is still running.
            if (!res.success) {
                setTestResults((prev) => ({ ...prev, [id]: { error: res.error_message || "Test failed" } }));
                return;
            }
            // Kept until dismissed: it used to vanish after five seconds,
            // usually while the operator was still reading the value.
            setTestResults((prev) => ({ ...prev, [id]: { value: res.data.value, would_fire: res.data.firing } }));
        } catch (err) {
            reportError("alert_rule.test.failed", err, {
                rule_id: id,
                outcome: "no test result shown; user toasted",
            });
            setTestResults((prev) => ({ ...prev, [id]: { error: "Could not test the rule" } }));
        }
    };

    const filteredRules = useMemo(() => {
        const q = ruleSearch.trim().toLowerCase();
        const matches = rules.filter((r) => {
            // Filters are searchable too: "broker.heartbeat" or a service name
            // finds the rules that watch it.
            const haystack = `${r.name} ${r.description} ${parseFilters(r.query_filters).map(describeFilter).join(" ")}`;
            if (q && !haystack.toLowerCase().includes(q)) return false;
            switch (ruleStateFilter) {
                case "firing":
                    return r.enabled && r.state?.status === "firing";
                case "enabled":
                    return r.enabled;
                case "disabled":
                    return !r.enabled;
                default:
                    return true;
            }
        });
        // Firing first: on call, that is the row being looked for.
        const firing = (r: AlertRuleRow) => (r.enabled && r.state?.status === "firing" ? 0 : 1);
        return matches.sort((a, b) => firing(a) - firing(b));
    }, [rules, ruleSearch, ruleStateFilter]);

    const routingByRule = useMemo(() => {
        if (routingLoading || routingError) return null;
        return new Map(rules.map((r) => [r.id, previewRouting(r, policies, channels, groups)]));
    }, [rules, policies, channels, groups, routingLoading, routingError]);

    const firingCount = rules.filter((r) => r.enabled && r.state?.status === "firing").length;
    const filteredIds = useMemo(() => filteredRules.map((r) => r.id), [filteredRules]);
    const selection = useSelection(filteredIds);
    const retryRouting = () => {
        setRoutingError(null);
        fetchRouting();
    };

    const formModalProps = {
        submitting: ruleSubmitting,
        serverError: ruleFormError,
        onClearServerError: () => setRuleFormError(null),
        policies,
        channels,
        groups,
        routingError,
        routingLoading,
        onRetryRouting: retryRouting,
    };

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Alerts
                        </h1>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                            Configure alert rules and view alert history. Notification routing is managed in{" "}
                            <Link href={zoned("/settings/notifications")} className="text-blue-600 dark:text-blue-400 hover:underline">
                                Notifications
                            </Link>.
                        </p>
                    </div>
                </div>

                <Tabs id="alerts" label="Alert sections" items={tabs} value={activeTab} onChange={setActiveTab} />

                {/* Rules Tab */}
                {activeTab === "rules" && (
                    <TabPanel tabsId="alerts" value="rules" className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="relative min-w-[200px] flex-1 max-w-sm">
                                <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500" />
                                <input
                                    type="search"
                                    value={ruleSearch}
                                    onChange={(e) => setRuleSearch(e.target.value)}
                                    placeholder="Search rules, services, events"
                                    aria-label="Search rules"
                                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-base sm:text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                />
                            </div>
                            <Segmented
                                label="Filter rules by state"
                                options={STATE_OPTIONS.map((o) => ({
                                    ...o,
                                    label:
                                        o.value === "firing" && firingCount > 0 ? (
                                            <>
                                                Firing
                                                <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{firingCount}</span>
                                            </>
                                        ) : (
                                            o.label
                                        ),
                                }))}
                                value={ruleStateFilter}
                                onChange={setRuleStateFilter}
                            />
                            <div className="ml-auto flex flex-wrap items-center gap-3">
                                {/* Partial, so it sits beside the list rather than
                                    replacing it: the rules themselves are readable,
                                    only their routing is missing. The form repeats
                                    it where the routing is shown. */}
                                {routingError && (
                                    <FailureNote
                                        what="notification routing"
                                        message={routingError}
                                        onRetry={retryRouting}
                                    />
                                )}
                                {canWrite && (
                                    <button
                                        onClick={() => {
                                            setRuleFormError(null);
                                            setShowRuleForm(true);
                                        }}
                                        className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                    >
                                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                        Create rule
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* No overflow-hidden: the phone-width row menu drops below its row. */}
                        <div
                            className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm"
                            aria-busy={rulesLoading}
                        >
                            {/* A reload after a write keeps the rows and shows this bar;
                                only the first load (nothing on screen yet) skeletons.
                                Always rendered so its 2px never shifts the list. */}
                            <RefetchBar active={rulesLoading && rules.length > 0} className="rounded-t-xl" />
                            {rulesLoading && rules.length === 0 ? (
                                // Rows sized to a real RuleRow (badges + condition + routing ≈ 92px).
                                <SkeletonRows rows={5} label="Loading alert rules" rowClass="h-[92px]" leading={false} />
                            ) : rulesError ? (
                                <FailureState
                                    what="alert rules"
                                    message={rulesError}
                                    onRetry={fetchRules}
                                    className="border-0"
                                />
                            ) : rules.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                    <p className="text-sm font-medium">No alert rules</p>
                                    <p className="text-xs mt-1">{canWrite ? "Create your first alert rule to get started." : "An editor can create one."}</p>
                                </div>
                            ) : filteredRules.length === 0 ? (
                                <div className="py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">
                                    No rules match.{" "}
                                    <button
                                        onClick={() => {
                                            setRuleSearch("");
                                            setRuleStateFilter("all");
                                        }}
                                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                        Clear filters
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    {canWrite && (
                                        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                                            <Checkbox
                                                checked={selection.allSelected}
                                                indeterminate={selection.someSelected}
                                                onChange={selection.toggleAll}
                                                label="Select all rules shown"
                                            />
                                            <span>
                                                {filteredRules.length} rule{filteredRules.length === 1 ? "" : "s"}
                                                {filteredRules.length !== rules.length ? ` of ${rules.length}` : ""}
                                            </span>
                                        </div>
                                    )}
                                    {filteredRules.map((rule) => (
                                        <RuleRow
                                            key={rule.id}
                                            rule={rule}
                                            routing={routingByRule ? routingByRule.get(rule.id) : routingError ? null : undefined}
                                            test={testResults[rule.id]}
                                            onDismissTest={() =>
                                                setTestResults((prev) => {
                                                    const next = { ...prev };
                                                    delete next[rule.id];
                                                    return next;
                                                })
                                            }
                                            canWrite={canWrite}
                                            selected={selection.isSelected(rule.id)}
                                            onSelect={(e) => selection.toggle(rule.id, { shiftKey: e.shiftKey })}
                                            busy={busyIds.has(rule.id)}
                                            onTest={() => void handleTestRule(rule.id)}
                                            onToggle={() => void handleToggleRule(rule)}
                                            onDuplicate={() => void handleDuplicateRule(rule)}
                                            onEdit={() => {
                                                setRuleFormError(null);
                                                setEditingRule(rule);
                                            }}
                                            onDelete={() => void handleDeleteRule(rule)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                        <BulkActionBar count={selection.count} noun="rule" onClear={selection.clear}>
                            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkSetEnabled(true)}>Enable</Button>
                            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkSetEnabled(false)}>Disable</Button>
                            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkTest()} title="Dry run: evaluates now, sends nothing">Test</Button>
                            <select
                                aria-label="Set priority on selected rules"
                                value=""
                                disabled={bulkBusy}
                                onChange={(e) => {
                                    if (e.target.value) void bulkSetPriority(e.target.value as AlertPriority);
                                }}
                                className="h-7 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                                <option value="">Priority…</option>
                                {(["P0", "P1", "P2", "P3"] as AlertPriority[]).map((p) => (
                                    <option key={p} value={p}>{p} {PRIORITY_LABELS[p]}</option>
                                ))}
                            </select>
                            <Button size="sm" variant="destructive" loading={bulkBusy} onClick={() => void bulkDelete()}>Delete</Button>
                        </BulkActionBar>
                    </TabPanel>
                )}

                {/* History Tab */}
                {activeTab === "history" && (
                    <TabPanel tabsId="alerts" value="history">
                        <AlertHistoryTab
                            history={history}
                            loading={historyLoading}
                            error={historyError}
                            hasMore={historyHasMore}
                            onRetry={fetchHistory}
                            onLoadMore={() => setHistoryLimit((l) => l + HISTORY_PAGE_SIZE)}
                            rules={rules}
                            knownRules={knownRules}
                            ruleFilter={historyRuleFilter}
                            onRuleFilterChange={(id) => {
                                setHistoryRuleFilter(id);
                                setHistoryLimit(HISTORY_PAGE_SIZE);
                            }}
                        />
                    </TabPanel>
                )}
            </div>

            {/* Modals */}
            {showRuleForm && (
                <RuleFormModal
                    title="Create alert rule"
                    onClose={() => setShowRuleForm(false)}
                    onSubmit={handleCreateRule}
                    {...formModalProps}
                />
            )}
            {editingRule && (
                <RuleFormModal
                    title="Edit alert rule"
                    initial={ruleToForm(editingRule)}
                    onClose={() => setEditingRule(null)}
                    onSubmit={handleEditRule}
                    {...formModalProps}
                />
            )}
        </main>
    );
}
