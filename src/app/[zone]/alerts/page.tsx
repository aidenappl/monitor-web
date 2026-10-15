"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
    faCopy,
    faMagnifyingGlass,
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
import { FailureState, FailureNote } from "@/components/FailureState";
import { formatTimestamp } from "@/tools/format.tools";
import { reportError } from "@/services/monitor.service";
import { useZoneHref } from "@/hooks/useZoneHref";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";

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
        // Silent on purpose: a malformed stored filter only widens this routing
        // PREVIEW, and it runs on every render — a report would repeat per render.
    }

    return policies.filter((policy) => {
        if (!policy.enabled) return false;
        let matchers: PolicyMatchers;
        try {
            matchers = JSON.parse(policy.matchers);
        } catch {
            // Silent on purpose: an unparseable policy drops out of this per-render preview only.
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
        try { channelIds = JSON.parse(policy.channel_ids || "[]"); } catch { /* silent: per-render preview; an unparseable list shows no channels */ }
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
    enabled: boolean;
}

const HISTORY_PAGE_SIZE = 100;

type TestOutcome = { pending: true } | { error: string } | { value: number; would_fire: boolean };

function ruleToForm(rule: AlertRule): RuleFormData {
    return {
        name: rule.name,
        description: rule.description,
        type: rule.type,
        priority: rule.priority || "P2",
        query_filters: rule.query_filters,
        metric: rule.metric,
        field: rule.field,
        condition: rule.condition,
        threshold: rule.threshold,
        evaluation_interval_seconds: rule.evaluation_interval_seconds,
        for_seconds: rule.for_seconds,
        cooldown_seconds: rule.cooldown_seconds,
        enabled: rule.enabled,
    };
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
    enabled: true,
};

interface RuleFormModalProps {
    initial?: RuleFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: RuleFormData) => void;
    submitting: boolean;
    policies: NotificationPolicy[];
    channels: NotificationChannel[];
}

const inputClass =
    "w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

/** Parses an integer field, keeping an empty box empty while the user types. */
function intOr(value: string, fallback: number): number {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : n;
}

/**
 * The create/edit form, on the shared Modal.
 *
 * ⚠️ It was a bare fixed-position div: no focus trap, and its backdrop stayed
 * live while saving, so a stray click discarded a fully typed rule mid-request.
 * `dismissible={!submitting}` closes that.
 *
 * The routing preview is computed from the FORM, not from the rule as it was
 * opened: it used to be fixed at open time (P2 for a new rule), so changing the
 * priority to P0 still showed the P2 routing beneath it.
 */
function RuleFormModal({ initial, title, onClose, onSubmit, submitting, policies, channels }: RuleFormModalProps) {
    const zoned = useZoneHref();
    const [form, setForm] = useState<RuleFormData>(initial || DEFAULT_FORM);
    const nameRef = useRef<HTMLInputElement>(null);

    const handleChange = (field: keyof RuleFormData, value: string | number | boolean) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    // Invalid JSON was saved as-is and the evaluator then skipped the rule on
    // every tick — a rule that looks configured and never fires.
    const filtersError = useMemo(() => {
        try {
            const parsed = JSON.parse(form.query_filters || "[]");
            if (!Array.isArray(parsed)) return "Filters must be a JSON array.";
            for (const f of parsed) {
                if (!f || typeof f !== "object" || typeof f.field !== "string" || typeof f.operator !== "string") {
                    return 'Each filter needs "field", "operator" and "value".';
                }
            }
            return null;
        } catch {
            return "Not valid JSON.";
        }
    }, [form.query_filters]);

    const matchingPolicies = useMemo(
        () => getMatchingPolicies({ ...(form as unknown as AlertRule), name: form.name }, policies),
        [form, policies],
    );
    const resolvedRouting = resolveChannelsForPolicies(matchingPolicies, channels);
    const needsField = form.metric !== "count";

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (filtersError) return;
        onSubmit(form);
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={title}
            widthClass="max-w-2xl"
            dismissible={!submitting}
            initialFocusRef={nameRef}
        >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="rule-name" className={labelClass}>Name</label>
                        <input
                            id="rule-name"
                            ref={nameRef}
                            type="text"
                            value={form.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            required
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label htmlFor="rule-description" className={labelClass}>Description</label>
                        <input
                            id="rule-description"
                            type="text"
                            value={form.description}
                            onChange={(e) => handleChange("description", e.target.value)}
                            placeholder="What firing means and what to check first"
                            className={inputClass}
                        />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="rule-priority" className={labelClass}>Priority</label>
                            <select
                                id="rule-priority"
                                value={form.priority}
                                onChange={(e) => handleChange("priority", e.target.value)}
                                className={inputClass}
                            >
                                {(["P0", "P1", "P2", "P3"] as AlertPriority[]).map((p) => (
                                    <option key={p} value={p}>{p} {PRIORITY_LABELS[p]}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="rule-type" className={labelClass}>Type</label>
                            <select
                                id="rule-type"
                                value={form.type}
                                onChange={(e) => handleChange("type", e.target.value)}
                                className={inputClass}
                            >
                                <option value="threshold">Threshold</option>
                                <option value="absence">Absence</option>
                                <option value="rate_change">Rate Change</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="rule-metric" className={labelClass}>Metric</label>
                            <select
                                id="rule-metric"
                                value={form.metric}
                                onChange={(e) => handleChange("metric", e.target.value)}
                                className={inputClass}
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
                        <label htmlFor="rule-field" className={labelClass}>
                            Field {needsField ? "" : <span className="font-normal text-zinc-400">(not used by count)</span>}
                        </label>
                        <input
                            id="rule-field"
                            type="text"
                            value={form.field}
                            onChange={(e) => handleChange("field", e.target.value)}
                            placeholder="e.g. data.duration_ms"
                            required={needsField}
                            disabled={!needsField}
                            className={`${inputClass} disabled:opacity-50`}
                        />
                    </div>
                    <div>
                        <label htmlFor="rule-filters" className={labelClass}>Filters (JSON)</label>
                        <textarea
                            id="rule-filters"
                            value={form.query_filters}
                            onChange={(e) => handleChange("query_filters", e.target.value)}
                            rows={3}
                            spellCheck={false}
                            aria-invalid={Boolean(filtersError)}
                            aria-describedby="rule-filters-help"
                            className={`${inputClass} font-mono ${filtersError ? "border-red-400 dark:border-red-700" : ""}`}
                        />
                        <p id="rule-filters-help" className={`mt-1 text-xs ${filtersError ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                            {filtersError ?? 'e.g. [{"field": "service", "operator": "eq", "value": "billing"}]'}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="rule-condition" className={labelClass}>Condition</label>
                            <select
                                id="rule-condition"
                                value={form.condition}
                                onChange={(e) => handleChange("condition", e.target.value)}
                                className={inputClass}
                            >
                                <option value="gt">&gt; Greater than</option>
                                <option value="lt">&lt; Less than</option>
                                <option value="gte">&gt;= Greater or equal</option>
                                <option value="lte">&lt;= Less or equal</option>
                                <option value="eq">= Equal</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="rule-threshold" className={labelClass}>Threshold</label>
                            <input
                                id="rule-threshold"
                                type="number"
                                step="any"
                                value={form.threshold}
                                onChange={(e) => handleChange("threshold", parseFloat(e.target.value) || 0)}
                                className={inputClass}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="rule-interval" className={labelClass}>Every (s)</label>
                            <input
                                id="rule-interval"
                                type="number"
                                min={10}
                                value={form.evaluation_interval_seconds}
                                onChange={(e) => handleChange("evaluation_interval_seconds", intOr(e.target.value, 60))}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label htmlFor="rule-for" className={labelClass}>For (s)</label>
                            <input
                                id="rule-for"
                                type="number"
                                min={0}
                                value={form.for_seconds}
                                onChange={(e) => handleChange("for_seconds", intOr(e.target.value, 0))}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label htmlFor="rule-cooldown" className={labelClass}>Cooldown (s)</label>
                            <input
                                id="rule-cooldown"
                                type="number"
                                min={0}
                                value={form.cooldown_seconds}
                                // `|| 300` turned a deliberate 0 back into 300.
                                onChange={(e) => handleChange("cooldown_seconds", intOr(e.target.value, 0))}
                                className={inputClass}
                            />
                        </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <input
                            type="checkbox"
                            checked={form.enabled}
                            onChange={(e) => handleChange("enabled", e.target.checked)}
                            className="h-4 w-4 accent-blue-600"
                        />
                        Enabled
                    </label>

                    {/* Notification Routing Info */}
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Notification Routing</h4>
                            <Link
                                href={zoned("/notifications")}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                            >
                                Manage Policies
                                <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                            </Link>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                            Routed by policy on this rule&apos;s priority, service and environment — updates as you edit.
                        </p>
                        {matchingPolicies.length > 0 ? (
                            <div className="space-y-2">
                                {resolvedRouting.map((entry) => (
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
                                {resolvedRouting.length === 0 && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">
                                        Matching policies have no channels assigned. Configure channels in{" "}
                                        <Link href={zoned("/notifications")} className="underline">Notifications</Link>.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                No policies match this rule yet. Create a policy to start receiving notifications.
                            </p>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={submitting} disabled={!form.name.trim() || Boolean(filtersError)}>
                            Save rule
                        </Button>
                    </div>
                </form>
        </Modal>
    );
}

// ─── Main Page ───

export default function AlertsPage() {
    const zoned = useZoneHref();
    const [activeTab, setActiveTab] = useState<TabId>("rules");

    // Rules
    const [rules, setRules] = useState<AlertRule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [rulesError, setRulesError] = useState<string | null>(null);
    const [showRuleForm, setShowRuleForm] = useState(false);
    const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
    const [ruleSubmitting, setRuleSubmitting] = useState(false);
    const [testResults, setTestResults] = useState<Record<string, TestOutcome>>({});
    const [ruleSearch, setRuleSearch] = useState("");
    const [ruleStateFilter, setRuleStateFilter] = useState<"all" | "firing" | "enabled" | "disabled">("all");
    const [bulkBusy, setBulkBusy] = useState(false);
    const confirm = useConfirm();
    const { canWrite } = useRole();

    // History
    const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [historyRuleFilter, setHistoryRuleFilter] = useState("");
    const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
    const [historyHasMore, setHistoryHasMore] = useState(false);

    // Policies and channels (for routing preview)
    const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    // One flag for both: they exist only to render the routing preview, and a
    // preview built from half the data is as misleading as one built from none.
    const [routingError, setRoutingError] = useState<string | null>(null);

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
            const rows = res.data;
            setHistory(rows);
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

    // Policies and channels drive the "→ Slack via Escalation" line under each
    // rule. Failing them silently drops that line, which reads as "this rule
    // notifies nobody" — a statement about the config, not about the fetch.
    const fetchPolicies = useCallback(async () => {
        try {
            const res = await reqListPolicies();
            if (!res.success) {
                setRoutingError(res.error_message || "The request failed.");
                return;
            }
            setPolicies(res.data);
        } catch (err) {
            reportError("notification_policy.list.failed", err, {
                outcome: "rule routing lines show a failure note",
            });
            setRoutingError("Failed to load notification policies");
        }
    }, []);

    const fetchChannels = useCallback(async () => {
        try {
            const res = await reqListNotificationChannels();
            if (!res.success) {
                setRoutingError(res.error_message || "The request failed.");
                return;
            }
            setChannels(res.data);
        } catch (err) {
            reportError("notification_channel.list.failed", err, {
                outcome: "rule routing lines show a failure note",
            });
            setRoutingError("Failed to load notification channels");
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

    // ⚠️ Every handler below used to `await` the request and then announce
    // success unconditionally. The catch never fires on a non-2xx, so a rejected
    // write showed a green toast, closed the form and refetched — and the refetch
    // quietly restored the old value. "Alert rule created" for a rule that does
    // not exist is the write-side of rendering DOWN as EMPTY.
    const handleCreateRule = async (data: RuleFormData) => {
        setRuleSubmitting(true);
        try {
            const res = await reqCreateAlertRule(data);
            if (!res.success) {
                toast.error(res.error_message || "Failed to create alert rule");
                return;
            }
            setShowRuleForm(false);
            toast.success("Alert rule created");
            fetchRules();
        } catch (err) {
            reportError("alert_rule.create.failed", err, {
                outcome: "rule not created; user toasted",
            });
            toast.error("Failed to create alert rule");
        } finally {
            setRuleSubmitting(false);
        }
    };

    const handleEditRule = async (data: RuleFormData) => {
        if (!editingRule) return;
        setRuleSubmitting(true);
        try {
            const res = await reqUpdateAlertRule(editingRule.id, data);
            if (!res.success) {
                toast.error(res.error_message || "Failed to update alert rule");
                return;
            }
            setEditingRule(null);
            toast.success("Alert rule updated");
            fetchRules();
        } catch (err) {
            reportError("alert_rule.save.failed", err, {
                rule_id: editingRule?.id,
                outcome: "rule edit not saved; user toasted",
            });
            toast.error("Failed to update alert rule");
        } finally {
            setRuleSubmitting(false);
        }
    };

    const handleDeleteRule = async (rule: AlertRule) => {
        // ⚠️ This was one unconfirmed click on a trash icon next to the edit
        // pencil — on the page that decides whether anyone gets paged.
        const ok = await confirm({
            title: `Delete “${rule.name}”?`,
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
        const res = await reqCreateAlertRule({
            ...ruleToForm(rule),
            name: `${rule.name} (copy)`,
            // A copy starts disabled: two identical enabled rules page twice.
            enabled: false,
        });
        if (!res.success) {
            toast.error(res.error_message || "Failed to duplicate the rule");
            return;
        }
        toast.success("Duplicated — the copy starts disabled");
        fetchRules();
    };

    const bulkSetEnabled = async (enabled: boolean) => {
        const targets = rules.filter((r) => selection.isSelected(r.id) && r.enabled !== enabled);
        if (targets.length === 0) {
            toast(`All selected rules are already ${enabled ? "enabled" : "disabled"}`);
            return;
        }
        setBulkBusy(true);
        const result = await runBulk(targets, (r) => reqUpdateAlertRule(r.id, { enabled }));
        setBulkBusy(false);
        toastBulkResult(result, enabled ? "Enabled" : "Disabled", "rule");
        selection.clear();
        fetchRules();
    };

    const bulkSetPriority = async (priority: AlertPriority) => {
        const targets = rules.filter((r) => selection.isSelected(r.id) && (r.priority || "P2") !== priority);
        if (targets.length === 0) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (r) => reqUpdateAlertRule(r.id, { priority }));
        setBulkBusy(false);
        toastBulkResult(result, `Set ${priority} on`, "rule");
        fetchRules();
    };

    const bulkDelete = async () => {
        const targets = rules.filter((r) => selection.isSelected(r.id));
        const ok = await confirm({
            title: `Delete ${targets.length} alert rule${targets.length === 1 ? "" : "s"}?`,
            description: (
                <>
                    {targets.slice(0, 5).map((r) => r.name).join(", ")}
                    {targets.length > 5 ? ` and ${targets.length - 5} more` : ""}. They stop evaluating immediately.
                </>
            ),
            confirmLabel: `Delete ${targets.length} rule${targets.length === 1 ? "" : "s"}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (r) => reqDeleteAlertRule(r.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "rule");
        selection.clear();
        fetchRules();
    };

    const bulkTest = async () => {
        const targets = rules.filter((r) => selection.isSelected(r.id));
        setBulkBusy(true);
        const outcomes = await Promise.all(
            targets.map(async (r) => ({ rule: r, res: await reqTestAlertRule(r.id) })),
        );
        setBulkBusy(false);
        const next: Record<string, TestOutcome> = {};
        for (const { rule, res } of outcomes) {
            next[rule.id] = res.success
                ? { value: res.data.value, would_fire: res.data.firing }
                : { error: res.error_message || "Test failed" };
        }
        setTestResults((prev) => ({ ...prev, ...next }));
        const firing = Object.values(next).filter((o) => "would_fire" in o && o.would_fire).length;
        toast(`${targets.length} tested · ${firing} would fire`);
    };

    const handleToggleRule = async (rule: AlertRule) => {
        try {
            const res = await reqUpdateAlertRule(rule.id, { enabled: !rule.enabled });
            if (!res.success) {
                toast.error(res.error_message || "Failed to toggle alert rule");
                return;
            }
            fetchRules();
            toast.success(rule.enabled ? "Rule disabled" : "Rule enabled");
        } catch (err) {
            reportError("alert_rule.toggle.failed", err, {
                rule_id: rule.id,
                enabling: !rule.enabled,
                outcome: "rule state unchanged; user toasted",
            });
            toast.error("Failed to toggle alert rule");
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
        return rules.filter((r) => {
            if (q && !`${r.name} ${r.description}`.toLowerCase().includes(q)) return false;
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
    }, [rules, ruleSearch, ruleStateFilter]);

    const firingCount = rules.filter((r) => r.enabled && r.state?.status === "firing").length;
    const filteredIds = useMemo(() => filteredRules.map((r) => r.id), [filteredRules]);
    const selection = useSelection(filteredIds);

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Alerts
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Configure alert rules and view alert history. Notification routing is managed in{" "}
                            <Link href={zoned("/notifications")} className="text-blue-600 dark:text-blue-400 hover:underline">
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
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="relative min-w-[200px] flex-1 max-w-sm">
                                <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400" />
                                <input
                                    value={ruleSearch}
                                    onChange={(e) => setRuleSearch(e.target.value)}
                                    placeholder="Search rules"
                                    aria-label="Search rules"
                                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                />
                            </div>
                            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden" role="group" aria-label="Filter rules by state">
                                {(["all", "firing", "enabled", "disabled"] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setRuleStateFilter(f)}
                                        aria-pressed={ruleStateFilter === f}
                                        className={`px-3 py-2 text-xs font-medium capitalize transition-colors border-r last:border-r-0 border-zinc-200 dark:border-zinc-700 ${
                                            ruleStateFilter === f
                                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                                : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                                        }`}
                                    >
                                        {f}
                                        {f === "firing" && firingCount > 0 && (
                                            <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{firingCount}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                            <div className="ml-auto flex items-center gap-3">
                                {/* Partial, so it sits beside the list rather than
                                    replacing it: the rules themselves are readable,
                                    only their routing preview is missing. */}
                                {routingError && (
                                    <FailureNote
                                        what="notification routing"
                                        message={routingError}
                                        onRetry={() => {
                                            setRoutingError(null);
                                            fetchPolicies();
                                            fetchChannels();
                                        }}
                                    />
                                )}
                                {canWrite && (
                                    <button
                                        onClick={() => setShowRuleForm(true)}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                    >
                                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                        Create Rule
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {rulesLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : rulesError ? (
                                <FailureState
                                    what="alert rules"
                                    message={rulesError}
                                    onRetry={fetchRules}
                                    className="rounded-none border-0"
                                />
                            ) : rules.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                    <p className="text-sm font-medium">No alert rules</p>
                                    <p className="text-xs mt-1">{canWrite ? "Create your first alert rule to get started." : "An editor can create one."}</p>
                                </div>
                            ) : filteredRules.length === 0 ? (
                                <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
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
                                        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
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
                                    {filteredRules.map((rule) => {
                                        const matching = getMatchingPolicies(rule, policies);
                                        const test = testResults[rule.id];
                                        return (
                                            <div
                                                key={rule.id}
                                                className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 transition-colors ${
                                                    selection.isSelected(rule.id)
                                                        ? "bg-blue-50/60 dark:bg-blue-900/10"
                                                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                                }`}
                                            >
                                                {canWrite && (
                                                    <Checkbox
                                                        checked={selection.isSelected(rule.id)}
                                                        onChange={(e) => selection.toggle(rule.id, { shiftKey: e.shiftKey })}
                                                        label={`Select ${rule.name}`}
                                                    />
                                                )}
                                                <div className={`flex-1 min-w-0 ${rule.enabled ? "" : "opacity-60"}`}>
                                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {rule.name}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(rule.type)}`}>
                                                            {rule.type.replace("_", " ")}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[rule.priority || "P2"]}`}>
                                                            {rule.priority || "P2"}
                                                        </span>
                                                        {rule.enabled ? (
                                                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(rule.state?.status || "ok")}`}>
                                                                {rule.state?.status || "ok"}
                                                            </span>
                                                        ) : (
                                                            // A disabled rule's last state is history, not
                                                            // news: "ok" beside "disabled" read as healthy.
                                                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                                                disabled
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                        <span className="font-mono">
                                                            {rule.metric}
                                                            {rule.field && rule.metric !== "count" ? `(${rule.field})` : ""} {CONDITION_LABELS[rule.condition] || rule.condition} {rule.threshold}
                                                        </span>
                                                        <span className="text-zinc-400"> · every {rule.evaluation_interval_seconds}s</span>
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
                                                    {test && (
                                                        <div className="mt-1.5 inline-flex items-center gap-2 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                                                            {"pending" in test ? (
                                                                <span className="text-zinc-500"><FontAwesomeIcon icon={faSpinner} className="mr-1 animate-spin" />Testing…</span>
                                                            ) : "error" in test ? (
                                                                <span className="text-red-600 dark:text-red-400">Test failed: {test.error}</span>
                                                            ) : (
                                                                <span className={test.would_fire ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-emerald-600 dark:text-emerald-400"}>
                                                                    Current value {test.value.toLocaleString()} — {test.would_fire ? "would fire" : "would not fire"}
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={() => setTestResults((prev) => {
                                                                    const next = { ...prev };
                                                                    delete next[rule.id];
                                                                    return next;
                                                                })}
                                                                aria-label="Dismiss test result"
                                                                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                                                            >
                                                                <FontAwesomeIcon icon={faXmark} className="text-[10px]" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <RuleAction label="Test rule now" icon={faFlask} onClick={() => handleTestRule(rule.id)} />
                                                    {canWrite && (
                                                        <>
                                                            <RuleAction
                                                                label={rule.enabled ? "Disable rule" : "Enable rule"}
                                                                icon={rule.enabled ? faToggleOn : faToggleOff}
                                                                iconClass={`text-lg ${rule.enabled ? "text-emerald-500" : ""}`}
                                                                onClick={() => handleToggleRule(rule)}
                                                            />
                                                            <RuleAction label="Duplicate rule" icon={faCopy} onClick={() => void handleDuplicateRule(rule)} />
                                                            <RuleAction label="Edit rule" icon={faPen} onClick={() => setEditingRule(rule)} />
                                                            <RuleAction label="Delete rule" icon={faTrash} destructive onClick={() => void handleDeleteRule(rule)} />
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <BulkActionBar count={selection.count} noun="rule" onClear={selection.clear}>
                            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkSetEnabled(true)}>Enable</Button>
                            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkSetEnabled(false)}>Disable</Button>
                            <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkTest()}>Test</Button>
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
                    </div>
                )}

                {/* History Tab */}
                {activeTab === "history" && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <select
                                value={historyRuleFilter}
                                onChange={(e) => {
                                    setHistoryRuleFilter(e.target.value);
                                    setHistoryLimit(HISTORY_PAGE_SIZE);
                                }}
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
                                aria-label="Refresh"
                                title="Refresh"
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
                            ) : historyError ? (
                                <FailureState
                                    what="alert history"
                                    message={historyError}
                                    onRetry={fetchHistory}
                                    className="rounded-none border-0"
                                />
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

                        {historyHasMore && !historyLoading && (
                            <div className="flex justify-center">
                                <button
                                    onClick={() => setHistoryLimit((l) => l + HISTORY_PAGE_SIZE)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                                >
                                    Load more
                                </button>
                            </div>
                        )}
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
                    policies={policies}
                    channels={channels}
                />
            )}
            {editingRule && (
                <RuleFormModal
                    title={`Edit “${editingRule.name}”`}
                    initial={ruleToForm(editingRule)}
                    onClose={() => setEditingRule(null)}
                    onSubmit={handleEditRule}
                    submitting={ruleSubmitting}
                    policies={policies}
                    channels={channels}
                />
            )}
        </main>
    );
}

function RuleAction({
    label,
    icon,
    onClick,
    destructive,
    iconClass = "text-sm",
}: {
    label: string;
    icon: typeof faPen;
    onClick: () => void;
    destructive?: boolean;
    iconClass?: string;
}) {
    // Icon-only, so the label is both the accessible name and the tooltip: a
    // flask and a pencil do not explain themselves.
    return (
        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`p-2 text-zinc-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                destructive ? "hover:text-red-500 dark:hover:text-red-400" : "hover:text-zinc-600 dark:hover:text-zinc-300"
            }`}
        >
            <FontAwesomeIcon icon={icon} className={iconClass} />
        </button>
    );
}
