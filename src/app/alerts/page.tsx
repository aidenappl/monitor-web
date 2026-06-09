"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faArrowsRotate,
    faPlus,
    faXmark,
    faTrash,
    faToggleOn,
    faToggleOff,
    faFlask,
    faPen,
    faArrowRight,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import {
    AlertRule,
    AlertHistoryEntry,
    NotificationPolicy,
    NotificationChannel,
    PolicyMatchers,
    AlertPriority,
    PRIORITY_LABELS,
    PRIORITY_COLORS,
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
} from "@/services/api";
import { formatTimestamp } from "@/tools/format.tools";

type TabId = "rules" | "history";

const tabs: { id: TabId; label: string }[] = [
    { id: "rules", label: "Rules" },
    { id: "history", label: "History" },
];

function statusBadgeClass(status: string): string {
    switch (status) {
        case "ok":
            return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
        case "firing":
            return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
        case "resolved":
            return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
        default:
            return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    }
}

function typeBadgeClass(type: string): string {
    switch (type) {
        case "threshold":
            return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
        case "absence":
            return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
        case "rate_change":
            return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
        default:
            return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    }
}

const CONDITION_LABELS: Record<string, string> = {
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
    eq: "=",
};

function getMatchingPolicies(rule: AlertRule, policies: NotificationPolicy[]): NotificationPolicy[] {
    const priority = rule.priority || "P2";

    let service = "";
    let env = "";
    try {
        const filters = JSON.parse(rule.query_filters || "[]") as { field: string; operator: string; value: string }[];
        for (const f of filters) {
            if (f.field === "service" && f.operator === "eq" && !service) service = f.value;
            if (f.field === "env" && f.operator === "eq" && !env) env = f.value;
        }
    } catch {
        // ignore
    }

    return policies.filter((policy) => {
        if (!policy.enabled) return false;
        let matchers: PolicyMatchers;
        try {
            matchers = JSON.parse(policy.matchers);
        } catch {
            return false;
        }

        if (matchers.priority && matchers.priority !== priority) return false;
        if (matchers.services && matchers.services.length > 0 && service && !matchers.services.includes(service)) return false;
        if (matchers.status && matchers.status !== "firing") return false;
        if (matchers.env && env && matchers.env !== env) return false;
        if (matchers.rule_name && !rule.name.toLowerCase().includes(matchers.rule_name.toLowerCase())) return false;

        return true;
    });
}

function resolveChannelsForPolicies(
    matchingPolicies: NotificationPolicy[],
    channels: NotificationChannel[],
): { policy: string; channels: { name: string; type: string }[] }[] {
    const channelMap = new Map(channels.map((ch) => [ch.id, ch]));
    return matchingPolicies.map((policy) => {
        let channelIds: string[] = [];
        try { channelIds = JSON.parse(policy.channel_ids || "[]"); } catch { /* ignore */ }
        return {
            policy: policy.name,
            channels: channelIds
                .map((id) => channelMap.get(id))
                .filter((ch): ch is NotificationChannel => ch != null)
                .map((ch) => ({ name: ch.name, type: ch.type })),
        };
    }).filter((entry) => entry.channels.length > 0);
}

// ─── Rule Form Modal ───

interface RuleFormData {
    name: string;
    description: string;
    type: "threshold" | "absence" | "rate_change";
    priority: AlertPriority;
    query_filters: string;
    metric: string;
    field: string;
    condition: "gt" | "lt" | "gte" | "lte" | "eq";
    threshold: number;
    evaluation_interval_seconds: number;
    for_seconds: number;
    cooldown_seconds: number;
    notification_channel_ids: string;
    enabled: boolean;
}

const DEFAULT_FORM: RuleFormData = {
    name: "",
    description: "",
    type: "threshold",
    priority: "P2",
    query_filters: "[]",
    metric: "count",
    field: "",
    condition: "gt",
    threshold: 0,
    evaluation_interval_seconds: 60,
    for_seconds: 0,
    cooldown_seconds: 300,
    notification_channel_ids: "[]",
    enabled: true,
};

interface RuleFormModalProps {
    initial?: RuleFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: RuleFormData) => void;
    submitting: boolean;
    matchingPolicies: NotificationPolicy[];
    channels: NotificationChannel[];
}

function RuleFormModal({ initial, title, onClose, onSubmit, submitting, matchingPolicies, channels }: RuleFormModalProps) {
    const [form, setForm] = useState<RuleFormData>(initial || DEFAULT_FORM);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleEsc);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", handleEsc);
            document.body.style.overflow = "";
        };
    }, [onClose]);

    const handleChange = (field: keyof RuleFormData, value: string | number | boolean) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ ...form, notification_channel_ids: "[]" });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
                    <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                        <FontAwesomeIcon icon={faXmark} className="text-lg" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            required
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Priority</label>
                            <select
                                value={form.priority}
                                onChange={(e) => handleChange("priority", e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {(["P0", "P1", "P2", "P3"] as AlertPriority[]).map((p) => (
                                    <option key={p} value={p}>{p} {PRIORITY_LABELS[p]}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                            <input
                                type="text"
                                value={form.description}
                                onChange={(e) => handleChange("description", e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
                            <select
                                value={form.type}
                                onChange={(e) => handleChange("type", e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="threshold">Threshold</option>
                                <option value="absence">Absence</option>
                                <option value="rate_change">Rate Change</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Metric</label>
                            <select
                                value={form.metric}
                                onChange={(e) => handleChange("metric", e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="count">Count</option>
                                <option value="avg">Avg</option>
                                <option value="sum">Sum</option>
                                <option value="min">Min</option>
                                <option value="max">Max</option>
                                <option value="p50">P50</option>
                                <option value="p95">P95</option>
                                <option value="p99">P99</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Field (for aggregation)</label>
                        <input
                            type="text"
                            value={form.field}
                            onChange={(e) => handleChange("field", e.target.value)}
                            placeholder="e.g. data.duration_ms"
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Filters (JSON)</label>
                        <textarea
                            value={form.query_filters}
                            onChange={(e) => handleChange("query_filters", e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Condition</label>
                            <select
                                value={form.condition}
                                onChange={(e) => handleChange("condition", e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="gt">&gt; Greater than</option>
                                <option value="lt">&lt; Less than</option>
                                <option value="gte">&gt;= Greater or equal</option>
                                <option value="lte">&lt;= Less or equal</option>
                                <option value="eq">= Equal</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Threshold</label>
                            <input
                                type="number"
                                value={form.threshold}
                                onChange={(e) => handleChange("threshold", parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Interval (s)</label>
                            <input
                                type="number"
                                value={form.evaluation_interval_seconds}
                                onChange={(e) => handleChange("evaluation_interval_seconds", parseInt(e.target.value) || 60)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">For (s)</label>
                            <input
                                type="number"
                                value={form.for_seconds}
                                onChange={(e) => handleChange("for_seconds", parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cooldown (s)</label>
                            <input
                                type="number"
                                value={form.cooldown_seconds}
                                onChange={(e) => handleChange("cooldown_seconds", parseInt(e.target.value) || 300)}
                                className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    {/* Notification Routing Info */}
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Notification Routing</h4>
                            <Link
                                href="/notifications"
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                            >
                                Manage Policies
                                <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                            </Link>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                            Notifications are routed by policies based on this rule&apos;s priority, service, and environment.
                        </p>
                        {matchingPolicies.length > 0 ? (
                            <div className="space-y-2">
                                {resolveChannelsForPolicies(matchingPolicies, channels).map((entry) => (
                                    <div key={entry.policy} className="flex items-center gap-2 text-xs">
                                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{entry.policy}</span>
                                        <span className="text-zinc-400">→</span>
                                        <div className="flex flex-wrap gap-1">
                                            {entry.channels.map((ch, i) => (
                                                <span key={i} className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                                    {ch.type === "pagerduty" ? "PD" : ch.type} · {ch.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                {resolveChannelsForPolicies(matchingPolicies, channels).length === 0 && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">
                                        Matching policies have no channels assigned. Configure channels in{" "}
                                        <Link href="/notifications" className="underline">Notifications</Link>.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                No policies match this rule yet. Create a policy to start receiving notifications.
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                        <button
                            type="submit"
                            disabled={submitting || !form.name.trim()}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                        >
                            {submitting ? (
                                <FontAwesomeIcon icon={faSpinner} className="animate-spin" />
                            ) : (
                                "Save"
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Main Page ───

export default function AlertsPage() {
    const [activeTab, setActiveTab] = useState<TabId>("rules");

    // Rules
    const [rules, setRules] = useState<AlertRule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [showRuleForm, setShowRuleForm] = useState(false);
    const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
    const [ruleSubmitting, setRuleSubmitting] = useState(false);
    const [testResult, setTestResult] = useState<{ ruleId: string; value: number; would_fire: boolean } | null>(null);

    // History
    const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyRuleFilter, setHistoryRuleFilter] = useState("");

    // Policies and channels (for routing preview)
    const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
    const [channels, setChannels] = useState<NotificationChannel[]>([]);

    const fetchRules = useCallback(async () => {
        setRulesLoading(true);
        try {
            const res = await reqListAlertRules();
            setRules(res.data || []);
        } catch {
            // ignore
        } finally {
            setRulesLoading(false);
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await reqListAlertHistory(historyRuleFilter || undefined, 100);
            setHistory(res.data || []);
        } catch {
            // ignore
        } finally {
            setHistoryLoading(false);
        }
    }, [historyRuleFilter]);

    const fetchPolicies = useCallback(async () => {
        try {
            const res = await reqListPolicies();
            setPolicies(res.data || []);
        } catch {
            // ignore
        }
    }, []);

    const fetchChannels = useCallback(async () => {
        try {
            const res = await reqListNotificationChannels();
            setChannels(res.data || []);
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        fetchRules();
        fetchPolicies();
        fetchChannels();
    }, [fetchRules, fetchPolicies, fetchChannels]);

    useEffect(() => {
        if (activeTab === "history") fetchHistory();
    }, [activeTab, fetchHistory]);

    const handleCreateRule = async (data: RuleFormData) => {
        setRuleSubmitting(true);
        try {
            await reqCreateAlertRule(data);
            setShowRuleForm(false);
            toast.success("Alert rule created");
            fetchRules();
        } catch {
            toast.error("Failed to create alert rule");
        } finally {
            setRuleSubmitting(false);
        }
    };

    const handleEditRule = async (data: RuleFormData) => {
        if (!editingRule) return;
        setRuleSubmitting(true);
        try {
            await reqUpdateAlertRule(editingRule.id, data);
            setEditingRule(null);
            toast.success("Alert rule updated");
            fetchRules();
        } catch {
            toast.error("Failed to update alert rule");
        } finally {
            setRuleSubmitting(false);
        }
    };

    const handleDeleteRule = async (id: string) => {
        try {
            await reqDeleteAlertRule(id);
            fetchRules();
            toast.success("Alert rule deleted");
        } catch {
            toast.error("Failed to delete alert rule");
        }
    };

    const handleToggleRule = async (rule: AlertRule) => {
        try {
            await reqUpdateAlertRule(rule.id, { enabled: !rule.enabled });
            fetchRules();
            toast.success(rule.enabled ? "Rule disabled" : "Rule enabled");
        } catch {
            toast.error("Failed to toggle alert rule");
        }
    };

    const handleTestRule = async (id: string) => {
        try {
            const res = await reqTestAlertRule(id);
            if (res.data) {
                setTestResult({ ruleId: id, ...res.data });
                setTimeout(() => setTestResult(null), 5000);
            }
        } catch {
            // ignore
        }
    };

    // Compute matching policies for the create form (based on default priority P2)
    const createFormMatchingPolicies = useMemo(() => {
        const fakeRule = { ...DEFAULT_FORM, priority: "P2" } as AlertRule;
        return getMatchingPolicies(fakeRule, policies);
    }, [policies]);

    // Compute matching policies for the edit form
    const editFormMatchingPolicies = useMemo(() => {
        if (!editingRule) return [];
        return getMatchingPolicies(editingRule, policies);
    }, [editingRule, policies]);

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Alerts
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Configure alert rules and view alert history. Notification routing is managed in{" "}
                            <Link href="/notifications" className="text-blue-600 dark:text-blue-400 hover:underline">
                                Notifications
                            </Link>.
                        </p>
                    </div>
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

                {/* Rules Tab */}
                {activeTab === "rules" && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowRuleForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Rule
                            </button>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {rulesLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : rules.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                    <p className="text-sm font-medium">No alert rules</p>
                                    <p className="text-xs mt-1">Create your first alert rule to get started.</p>
                                </div>
                            ) : (
                                <div>
                                    {rules.map((rule) => {
                                        const matching = getMatchingPolicies(rule, policies);
                                        return (
                                            <div
                                                key={rule.id}
                                                className="flex items-center gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {rule.name}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(rule.type)}`}>
                                                            {rule.type}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[rule.priority || "P2"]}`}>
                                                            {rule.priority || "P2"}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(rule.state?.status || "ok")}`}>
                                                            {rule.state?.status || "ok"}
                                                        </span>
                                                        {!rule.enabled && (
                                                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                                                                disabled
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                        {rule.metric} {CONDITION_LABELS[rule.condition] || rule.condition} {rule.threshold}
                                                        {rule.description && ` — ${rule.description}`}
                                                    </p>
                                                    {matching.length > 0 && (() => {
                                                        const resolved = resolveChannelsForPolicies(matching, channels);
                                                        const allChannelTypes = [...new Set(resolved.flatMap((r) => r.channels.map((c) => c.type)))];
                                                        return (
                                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                                                    {allChannelTypes.length > 0
                                                                        ? `→ ${allChannelTypes.map((t) => t === "pagerduty" ? "PagerDuty" : t.charAt(0).toUpperCase() + t.slice(1)).join(", ")} via`
                                                                        : "Routes to:"}
                                                                </span>
                                                                {matching.slice(0, 3).map((p) => (
                                                                    <span key={p.id} className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                                                        {p.name}
                                                                    </span>
                                                                ))}
                                                                {matching.length > 3 && (
                                                                    <span className="text-[10px] text-zinc-400">+{matching.length - 3} more</span>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                    {testResult && testResult.ruleId === rule.id && (
                                                        <p className={`text-xs mt-1 font-medium ${testResult.would_fire ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                            Test: value={testResult.value}, {testResult.would_fire ? "WOULD FIRE" : "OK"}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => handleToggleRule(rule)}
                                                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title={rule.enabled ? "Disable" : "Enable"}
                                                    >
                                                        <FontAwesomeIcon icon={rule.enabled ? faToggleOn : faToggleOff} className={`text-lg ${rule.enabled ? "text-emerald-500" : ""}`} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleTestRule(rule.id)}
                                                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Test rule"
                                                    >
                                                        <FontAwesomeIcon icon={faFlask} className="text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingRule(rule)}
                                                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Edit"
                                                    >
                                                        <FontAwesomeIcon icon={faPen} className="text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteRule(rule.id)}
                                                        className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Delete"
                                                    >
                                                        <FontAwesomeIcon icon={faTrash} className="text-sm" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* History Tab */}
                {activeTab === "history" && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <select
                                value={historyRuleFilter}
                                onChange={(e) => setHistoryRuleFilter(e.target.value)}
                                className="px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">All Rules</option>
                                {rules.map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>
                            <button
                                onClick={fetchHistory}
                                disabled={historyLoading}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
                            >
                                <FontAwesomeIcon
                                    icon={historyLoading ? faSpinner : faArrowsRotate}
                                    className={`text-sm ${historyLoading ? "animate-spin" : ""}`}
                                />
                            </button>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {historyLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : history.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <p className="text-sm font-medium">No alert history</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Time</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Rule</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                                                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Value</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {history.map((entry) => (
                                                <tr key={entry.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
                                                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                                                        {formatTimestamp(entry.created_at)}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                                                        {entry.rule_name}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(entry.status)}`}>
                                                            {entry.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                                                        {entry.value}
                                                    </td>
                                                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 truncate max-w-xs">
                                                        {entry.message}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            {showRuleForm && (
                <RuleFormModal
                    title="Create Alert Rule"
                    onClose={() => setShowRuleForm(false)}
                    onSubmit={handleCreateRule}
                    submitting={ruleSubmitting}
                    matchingPolicies={createFormMatchingPolicies}
                    channels={channels}
                />
            )}
            {editingRule && (
                <RuleFormModal
                    title="Edit Alert Rule"
                    initial={{
                        name: editingRule.name,
                        description: editingRule.description,
                        type: editingRule.type,
                        priority: editingRule.priority || "P2",
                        query_filters: editingRule.query_filters,
                        metric: editingRule.metric,
                        field: editingRule.field,
                        condition: editingRule.condition,
                        threshold: editingRule.threshold,
                        evaluation_interval_seconds: editingRule.evaluation_interval_seconds,
                        for_seconds: editingRule.for_seconds,
                        cooldown_seconds: editingRule.cooldown_seconds,
                        notification_channel_ids: editingRule.notification_channel_ids,
                        enabled: editingRule.enabled,
                    }}
                    onClose={() => setEditingRule(null)}
                    onSubmit={handleEditRule}
                    submitting={ruleSubmitting}
                    matchingPolicies={editFormMatchingPolicies}
                    channels={channels}
                />
            )}
        </main>
    );
}
