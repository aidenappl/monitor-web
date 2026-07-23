"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faPlus,
    faXmark,
    faTrash,
    faPen,
    faToggleOn,
    faToggleOff,
    faPaperPlane,
    faBell,
    faBellSlash,
    faArrowUp,
    faArrowDown,
    faCopy,
    faChevronDown,
    faChevronRight,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import {
    NotificationPolicy,
    ServiceGroup,
    NotificationChannel,
    PolicyMatchers,
    AlertPriority,
    AlertRule,
    PRIORITY_LABELS,
    PRIORITY_COLORS,
} from "@/types";
import {
    reqListPolicies,
    reqCreatePolicy,
    reqUpdatePolicy,
    reqDeletePolicy,
    reqReorderPolicies,
    reqListServiceGroups,
    reqCreateServiceGroup,
    reqUpdateServiceGroup,
    reqDeleteServiceGroup,
    reqListNotificationChannels,
    reqCreateNotificationChannel,
    reqDeleteNotificationChannel,
    reqTestNotificationChannel,
    reqListAlertRules,
} from "@/services/api";
import {
    useDesktopNotifications,
    getDesktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    requestNotificationPermission,
    getNotificationPermission,
} from "@/hooks/useDesktopNotifications";

type TabId = "policies" | "service-groups" | "channels" | "desktop";

const tabs: { id: TabId; label: string }[] = [
    { id: "policies", label: "Policies" },
    { id: "service-groups", label: "Service Groups" },
    { id: "channels", label: "Channels" },
    { id: "desktop", label: "Desktop" },
];

const INPUT_CLASS =
    "w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

function typeBadgeClass(type: string): string {
    switch (type) {
        case "webhook":
            return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
        case "slack":
            return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
        case "email":
            return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
        case "pagerduty":
            return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
        default:
            return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    }
}

function channelTypeIcon(type: string): string {
    switch (type) {
        case "webhook":
            return "HTTP";
        case "slack":
            return "#";
        case "email":
            return "@";
        case "pagerduty":
            return "PD";
        default:
            return "?";
    }
}

function parseJsonSafe<T>(value: string, fallback: T): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

/** Given a policy, count how many alert rules would match it. */
function getRulesMatchingPolicy(policy: NotificationPolicy, rules: AlertRule[]): number {
    let matchers: PolicyMatchers;
    try {
        matchers = JSON.parse(policy.matchers);
    } catch {
        return 0;
    }

    return rules.filter((rule) => {
        const priority = rule.priority || "P2";
        if (matchers.priority && matchers.priority !== priority) return false;

        let service = "";
        let env = "";
        try {
            const filters = JSON.parse(rule.query_filters || "[]") as {
                field: string;
                operator: string;
                value: string;
            }[];
            for (const f of filters) {
                if (f.field === "service" && f.operator === "eq" && !service) service = f.value;
                if (f.field === "env" && f.operator === "eq" && !env) env = f.value;
            }
        } catch {
            /* ignore */
        }

        if (matchers.services?.length && service && !matchers.services.includes(service)) return false;
        if (matchers.env && env && matchers.env !== env) return false;
        if (matchers.rule_name && !rule.name.toLowerCase().includes(matchers.rule_name.toLowerCase())) return false;

        return true;
    }).length;
}

/** Count matching rules from form data (for live preview in modal). */
function getRulesMatchingFormData(form: PolicyFormData, rules: AlertRule[]): number {
    const matchers: PolicyMatchers = {};
    if (form.priority) matchers.priority = form.priority;
    if (form.services.trim()) {
        matchers.services = form.services.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (form.service_group) matchers.service_group = form.service_group;
    if (form.status) matchers.status = form.status;
    if (form.env.trim()) matchers.env = form.env.trim();
    if (form.rule_name.trim()) matchers.rule_name = form.rule_name.trim();

    const fakePolicy: NotificationPolicy = {
        id: "",
        name: "",
        description: "",
        position: 0,
        matchers: JSON.stringify(matchers),
        channel_ids: "[]",
        continue_matching: false,
        repeat_interval_seconds: 0,
        enabled: true,
        is_default: false,
        created_at: "",
        updated_at: "",
    };
    return getRulesMatchingPolicy(fakePolicy, rules);
}

/** Priority bar color for the pipeline visualization. */
function priorityBarColor(matchers: PolicyMatchers): string {
    switch (matchers.priority) {
        case "P0":
            return "border-l-red-500";
        case "P1":
            return "border-l-orange-500";
        case "P2":
            return "border-l-yellow-500";
        case "P3":
            return "border-l-zinc-400 dark:border-l-zinc-600";
        default:
            return "border-l-zinc-300 dark:border-l-zinc-600";
    }
}

/** Build a compact matcher summary string. */
function buildMatcherSummary(matchers: PolicyMatchers, serviceGroups: ServiceGroup[]): string {
    const parts: string[] = [];

    if (matchers.priority && ["P0", "P1", "P2", "P3"].includes(matchers.priority)) {
        const label = PRIORITY_LABELS[matchers.priority as AlertPriority] || matchers.priority;
        parts.push(`${matchers.priority} ${label}`);
    }

    if (matchers.services && matchers.services.length > 0) {
        if (matchers.services.length <= 2) {
            parts.push(matchers.services.join(", "));
        } else {
            parts.push(`${matchers.services.length} services`);
        }
    }

    if (matchers.service_group) {
        const sg = serviceGroups.find((g) => g.id === matchers.service_group);
        parts.push(sg ? sg.name : "group");
    }

    if (matchers.env) {
        parts.push(matchers.env);
    }

    if (matchers.status) {
        parts.push(`${matchers.status} only`);
    }

    if (matchers.rule_name) {
        parts.push(`rule: ${matchers.rule_name}`);
    }

    return parts.join(" · ");
}

/** Format a relative time string. */
function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

// ─── Confirm Modal ───

interface ConfirmModalProps {
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmModalProps) {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        document.addEventListener("keydown", handleEsc);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", handleEsc);
            document.body.style.overflow = "";
        };
    }, [onCancel]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
            <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-sm p-6">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-2">{title}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">{message}</p>
                <div className="flex items-center gap-2 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Policy Form Modal ───

interface PolicyFormData {
    name: string;
    description: string;
    priority: string;
    services: string;
    service_group: string;
    status: string;
    env: string;
    rule_name: string;
    channel_ids: string[];
    continue_matching: boolean;
    enabled: boolean;
}

const DEFAULT_POLICY_FORM: PolicyFormData = {
    name: "",
    description: "",
    priority: "",
    services: "",
    service_group: "",
    status: "",
    env: "",
    rule_name: "",
    channel_ids: [],
    continue_matching: false,
    enabled: true,
};

interface PolicyFormModalProps {
    initial?: PolicyFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: PolicyFormData) => void;
    submitting: boolean;
    channels: NotificationChannel[];
    serviceGroups: ServiceGroup[];
    alertRules: AlertRule[];
}

function PolicyFormModal({
    initial,
    title,
    onClose,
    onSubmit,
    submitting,
    channels,
    serviceGroups,
    alertRules,
}: PolicyFormModalProps) {
    const [form, setForm] = useState<PolicyFormData>(initial || DEFAULT_POLICY_FORM);

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

    const handleChange = (field: keyof PolicyFormData, value: string | string[] | boolean) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const toggleChannel = (id: string) => {
        const next = form.channel_ids.includes(id)
            ? form.channel_ids.filter((c) => c !== id)
            : [...form.channel_ids, id];
        handleChange("channel_ids", next);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
    };

    const matchCount = useMemo(() => getRulesMatchingFormData(form, alertRules), [form, alertRules]);
    const totalRules = alertRules.length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <FontAwesomeIcon icon={faXmark} className="text-lg" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            required
                            className={INPUT_CLASS}
                            placeholder="e.g. Critical PagerDuty"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={(e) => handleChange("description", e.target.value)}
                            className={INPUT_CLASS}
                            placeholder="Optional description"
                        />
                    </div>

                    {/* When Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                When should this trigger?
                            </h4>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pl-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Priority</label>
                                <select
                                    value={form.priority}
                                    onChange={(e) => handleChange("priority", e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">Any</option>
                                    <option value="P0">P0 Critical</option>
                                    <option value="P1">P1 High</option>
                                    <option value="P2">P2 Medium</option>
                                    <option value="P3">P3 Low</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                                <select
                                    value={form.status}
                                    onChange={(e) => handleChange("status", e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">Any</option>
                                    <option value="firing">Firing</option>
                                    <option value="resolved">Resolved</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Where Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                Which alerts should it match?
                            </h4>
                        </div>
                        <div className="space-y-3 pl-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Services</label>
                                <input
                                    type="text"
                                    value={form.services}
                                    onChange={(e) => handleChange("services", e.target.value)}
                                    className={INPUT_CLASS}
                                    placeholder="Comma-separated service names"
                                />
                                <p className="text-xs text-zinc-400 mt-1">e.g. forta-api, keyring-api, monitor-core</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Service Group</label>
                                <select
                                    value={form.service_group}
                                    onChange={(e) => handleChange("service_group", e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">None</option>
                                    {serviceGroups.map((sg) => (
                                        <option key={sg.id} value={sg.id}>
                                            {sg.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Environment</label>
                                    <input
                                        type="text"
                                        value={form.env}
                                        onChange={(e) => handleChange("env", e.target.value)}
                                        className={INPUT_CLASS}
                                        placeholder="e.g. production"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Rule Name</label>
                                    <input
                                        type="text"
                                        value={form.rule_name}
                                        onChange={(e) => handleChange("rule_name", e.target.value)}
                                        className={INPUT_CLASS}
                                        placeholder="Substring match"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Live match preview */}
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                        This policy would match{" "}
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{matchCount}</span>{" "}
                        of {totalRules} active alert rule{totalRules !== 1 ? "s" : ""}
                    </div>

                    {/* Channels */}
                    {channels.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Notification Channels</label>
                            <div className="space-y-1">
                                {channels.map((ch) => (
                                    <label key={ch.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                        <input
                                            type="checkbox"
                                            checked={form.channel_ids.includes(ch.id)}
                                            onChange={() => toggleChannel(ch.id)}
                                            className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                                        />
                                        {ch.name}
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(ch.type)}`}>
                                            {ch.type}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Toggles */}
                    <div className="flex items-center gap-6 pt-2">
                        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.continue_matching}
                                onChange={(e) => handleChange("continue_matching", e.target.checked)}
                                className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                            />
                            Continue matching
                        </label>
                        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={(e) => handleChange("enabled", e.target.checked)}
                                className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                            />
                            Enabled
                        </label>
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

// ─── Service Group Form Modal ───

interface ServiceGroupFormData {
    name: string;
    description: string;
    services: string;
}

const DEFAULT_SG_FORM: ServiceGroupFormData = {
    name: "",
    description: "",
    services: "",
};

interface ServiceGroupFormModalProps {
    initial?: ServiceGroupFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: ServiceGroupFormData) => void;
    submitting: boolean;
}

function ServiceGroupFormModal({
    initial,
    title,
    onClose,
    onSubmit,
    submitting,
}: ServiceGroupFormModalProps) {
    const [form, setForm] = useState<ServiceGroupFormData>(initial || DEFAULT_SG_FORM);

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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <FontAwesomeIcon icon={faXmark} className="text-lg" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            required
                            className={INPUT_CLASS}
                            placeholder="e.g. Production Services"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            className={INPUT_CLASS}
                            placeholder="Optional description"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Services</label>
                        <textarea
                            value={form.services}
                            onChange={(e) => setForm((prev) => ({ ...prev, services: e.target.value }))}
                            rows={4}
                            className={INPUT_CLASS}
                            placeholder={"One service per line, or comma-separated:\nforta-api\nkeyring-api\nmonitor-core"}
                        />
                        <p className="text-xs text-zinc-400 mt-1">One service per line, or comma-separated</p>
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

// ─── Channel Form Modal ───

interface ChannelFormModalProps {
    onClose: () => void;
    onSubmit: (name: string, type: string, config: string) => void;
    submitting: boolean;
}

function ChannelFormModal({ onClose, onSubmit, submitting }: ChannelFormModalProps) {
    const [name, setName] = useState("");
    const [type, setType] = useState("webhook");

    // Webhook
    const [webhookUrl, setWebhookUrl] = useState("");
    // Slack
    const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
    // Email
    const [smtpHost, setSmtpHost] = useState("");
    const [smtpPort, setSmtpPort] = useState("587");
    const [smtpUsername, setSmtpUsername] = useState("");
    const [smtpPassword, setSmtpPassword] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [fromName, setFromName] = useState("");
    const [emailTo, setEmailTo] = useState("");
    // PagerDuty
    const [routingKey, setRoutingKey] = useState("");
    const [severity, setSeverity] = useState("critical");

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

    const buildConfig = (): string => {
        switch (type) {
            case "webhook":
                return JSON.stringify({ url: webhookUrl });
            case "slack":
                return JSON.stringify({ webhook_url: slackWebhookUrl });
            case "email":
                return JSON.stringify({
                    smtp_host: smtpHost,
                    smtp_port: smtpPort,
                    smtp_username: smtpUsername,
                    smtp_password: smtpPassword,
                    from_email: fromEmail,
                    from_name: fromName,
                    to: emailTo,
                });
            case "pagerduty":
                return JSON.stringify({ routing_key: routingKey, severity });
            default:
                return "{}";
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(name, type, buildConfig());
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create Channel</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <FontAwesomeIcon icon={faXmark} className="text-lg" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={INPUT_CLASS} placeholder="e.g. Production Alerts" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
                        <select value={type} onChange={(e) => setType(e.target.value)} className={INPUT_CLASS}>
                            <option value="webhook">Webhook</option>
                            <option value="slack">Slack</option>
                            <option value="email">Email (SMTP)</option>
                            <option value="pagerduty">PagerDuty</option>
                        </select>
                    </div>

                    {type === "webhook" && (
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Webhook URL</label>
                            <input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required className={INPUT_CLASS} placeholder="https://example.com/webhook" />
                        </div>
                    )}

                    {type === "slack" && (
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Slack Webhook URL</label>
                            <input type="url" value={slackWebhookUrl} onChange={(e) => setSlackWebhookUrl(e.target.value)} required className={INPUT_CLASS} placeholder="https://hooks.slack.com/services/..." />
                        </div>
                    )}

                    {type === "email" && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">SMTP Host</label>
                                    <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required className={INPUT_CLASS} placeholder="smtp.gmail.com" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">SMTP Port</label>
                                    <input type="text" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={INPUT_CLASS} placeholder="587" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Username</label>
                                    <input type="text" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} className={INPUT_CLASS} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Password</label>
                                    <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} className={INPUT_CLASS} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">From Email</label>
                                    <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={INPUT_CLASS} placeholder="alerts@example.com" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">From Name</label>
                                    <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} className={INPUT_CLASS} placeholder="Monitor Alerts" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Recipients</label>
                                <input type="text" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} required className={INPUT_CLASS} placeholder="user@example.com, user2@example.com" />
                                <p className="text-xs text-zinc-400 mt-1">Comma-separated email addresses</p>
                            </div>
                        </>
                    )}

                    {type === "pagerduty" && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Integration Key (Routing Key)</label>
                                <input type="text" value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} required className={INPUT_CLASS} placeholder="Events API v2 integration key" />
                                <p className="text-xs text-zinc-400 mt-1">From your PagerDuty service&apos;s Events API v2 integration</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Default Severity</label>
                                <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={INPUT_CLASS}>
                                    <option value="critical">Critical</option>
                                    <option value="error">Error</option>
                                    <option value="warning">Warning</option>
                                    <option value="info">Info</option>
                                </select>
                            </div>
                        </>
                    )}

                    <div className="flex items-center gap-2 pt-2">
                        <button
                            type="submit"
                            disabled={submitting || !name.trim()}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                        >
                            {submitting ? <FontAwesomeIcon icon={faSpinner} className="animate-spin" /> : "Create"}
                        </button>
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Main Page ───

export default function NotificationsPage() {
    const [activeTab, setActiveTab] = useState<TabId>("policies");

    // Desktop notifications
    useDesktopNotifications();
    const [desktopEnabled, setDesktopEnabled] = useState(false);
    const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

    useEffect(() => {
        setDesktopEnabled(getDesktopNotificationsEnabled());
        setNotifPermission(getNotificationPermission());
    }, []);

    // Policies
    const [policies, setPolicies] = useState<NotificationPolicy[]>([]);
    const [policiesLoading, setPoliciesLoading] = useState(true);
    const [showPolicyForm, setShowPolicyForm] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<NotificationPolicy | null>(null);
    const [policySubmitting, setPolicySubmitting] = useState(false);

    // Service Groups
    const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
    const [serviceGroupsLoading, setServiceGroupsLoading] = useState(true);
    const [showSGForm, setShowSGForm] = useState(false);
    const [editingSG, setEditingSG] = useState<ServiceGroup | null>(null);
    const [sgSubmitting, setSGSubmitting] = useState(false);

    // Channels
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    const [channelsLoading, setChannelsLoading] = useState(false);
    const [showChannelForm, setShowChannelForm] = useState(false);
    const [channelSubmitting, setChannelSubmitting] = useState(false);
    const [testingChannelId, setTestingChannelId] = useState<string | null>(null);

    // Channel health indicators
    const [testedChannels, setTestedChannels] = useState<Map<string, { success: boolean; time: Date }>>(new Map());
    // Force re-render for time-ago updates
    const [, setTick] = useState(0);

    // Alert rules (for connected alerts count)
    const [alertRules, setAlertRules] = useState<AlertRule[]>([]);

    // Expandable matcher detail per policy
    const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());

    // Confirmation dialog state
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

    // Tick every 30s to keep time-ago labels fresh
    useEffect(() => {
        const interval = setInterval(() => setTick((t) => t + 1), 30000);
        return () => clearInterval(interval);
    }, []);

    // ─── Fetchers ───

    const fetchPolicies = useCallback(async () => {
        setPoliciesLoading(true);
        try {
            const res = await reqListPolicies();
            const data = res.data || [];
            data.sort((a, b) => a.position - b.position);
            setPolicies(data);
        } catch {
            // ignore
        } finally {
            setPoliciesLoading(false);
        }
    }, []);

    const fetchServiceGroups = useCallback(async () => {
        setServiceGroupsLoading(true);
        try {
            const res = await reqListServiceGroups();
            setServiceGroups(res.data || []);
        } catch {
            // ignore
        } finally {
            setServiceGroupsLoading(false);
        }
    }, []);

    const fetchChannels = useCallback(async () => {
        setChannelsLoading(true);
        try {
            const res = await reqListNotificationChannels();
            setChannels(res.data || []);
        } catch {
            // ignore
        } finally {
            setChannelsLoading(false);
        }
    }, []);

    const fetchAlertRules = useCallback(async () => {
        try {
            const res = await reqListAlertRules();
            setAlertRules(res.data || []);
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        fetchPolicies();
        fetchServiceGroups();
        fetchChannels();
        fetchAlertRules();
    }, [fetchPolicies, fetchServiceGroups, fetchChannels, fetchAlertRules]);

    // ─── Policy Helpers ───

    function buildPolicyPayload(form: PolicyFormData): Partial<NotificationPolicy> {
        const matchers: PolicyMatchers = {};
        if (form.priority) matchers.priority = form.priority;
        if (form.services.trim()) {
            matchers.services = form.services
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        }
        if (form.service_group) matchers.service_group = form.service_group;
        if (form.status) matchers.status = form.status;
        if (form.env.trim()) matchers.env = form.env.trim();
        if (form.rule_name.trim()) matchers.rule_name = form.rule_name.trim();

        return {
            name: form.name,
            description: form.description,
            matchers: JSON.stringify(matchers),
            channel_ids: JSON.stringify(form.channel_ids),
            continue_matching: form.continue_matching,
            enabled: form.enabled,
        };
    }

    function policyToFormData(policy: NotificationPolicy): PolicyFormData {
        const matchers = parseJsonSafe<PolicyMatchers>(policy.matchers, {});
        const channelIds = parseJsonSafe<string[]>(policy.channel_ids, []);
        return {
            name: policy.name,
            description: policy.description,
            priority: matchers.priority || "",
            services: (matchers.services || []).join(", "),
            service_group: matchers.service_group || "",
            status: matchers.status || "",
            env: matchers.env || "",
            rule_name: matchers.rule_name || "",
            channel_ids: channelIds,
            continue_matching: policy.continue_matching,
            enabled: policy.enabled,
        };
    }

    const handleCreatePolicy = async (form: PolicyFormData) => {
        setPolicySubmitting(true);
        try {
            await reqCreatePolicy(buildPolicyPayload(form));
            setShowPolicyForm(false);
            fetchPolicies();
            toast.success("Policy created");
        } catch {
            toast.error("Failed to create policy");
        } finally {
            setPolicySubmitting(false);
        }
    };

    const handleEditPolicy = async (form: PolicyFormData) => {
        if (!editingPolicy) return;
        setPolicySubmitting(true);
        try {
            await reqUpdatePolicy(editingPolicy.id, buildPolicyPayload(form));
            setEditingPolicy(null);
            fetchPolicies();
            toast.success("Policy updated");
        } catch {
            toast.error("Failed to update policy");
        } finally {
            setPolicySubmitting(false);
        }
    };

    const handleDeletePolicy = async (id: string) => {
        try {
            await reqDeletePolicy(id);
            fetchPolicies();
            toast.success("Policy deleted");
        } catch {
            toast.error("Failed to delete policy");
        }
    };

    const handleDuplicatePolicy = async (policy: NotificationPolicy) => {
        try {
            const matchers = policy.matchers;
            const channelIds = policy.channel_ids;
            await reqCreatePolicy({
                name: `${policy.name} (Copy)`,
                description: policy.description,
                matchers,
                channel_ids: channelIds,
                continue_matching: policy.continue_matching,
                enabled: false,
            });
            fetchPolicies();
            toast.success("Policy duplicated");
        } catch {
            toast.error("Failed to duplicate policy");
        }
    };

    const handleTogglePolicy = async (policy: NotificationPolicy) => {
        try {
            await reqUpdatePolicy(policy.id, { enabled: !policy.enabled });
            fetchPolicies();
            toast.success(policy.enabled ? "Policy disabled" : "Policy enabled");
        } catch {
            toast.error("Failed to toggle policy");
        }
    };

    const handleMovePolicy = async (index: number, direction: "up" | "down") => {
        const swapIndex = direction === "up" ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= policies.length) return;

        const reordered = [...policies];
        const temp = reordered[index];
        reordered[index] = reordered[swapIndex];
        reordered[swapIndex] = temp;
        setPolicies(reordered);

        try {
            await reqReorderPolicies(reordered.map((p) => p.id));
        } catch {
            fetchPolicies();
        }
    };

    // ─── Service Group Helpers ───

    function parseServicesList(input: string): string[] {
        return input
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    const handleCreateSG = async (form: ServiceGroupFormData) => {
        setSGSubmitting(true);
        try {
            await reqCreateServiceGroup({
                name: form.name,
                description: form.description,
                services: JSON.stringify(parseServicesList(form.services)),
            });
            setShowSGForm(false);
            fetchServiceGroups();
            toast.success("Service group created");
        } catch {
            toast.error("Failed to create service group");
        } finally {
            setSGSubmitting(false);
        }
    };

    const handleEditSG = async (form: ServiceGroupFormData) => {
        if (!editingSG) return;
        setSGSubmitting(true);
        try {
            await reqUpdateServiceGroup(editingSG.id, {
                name: form.name,
                description: form.description,
                services: JSON.stringify(parseServicesList(form.services)),
            });
            setEditingSG(null);
            fetchServiceGroups();
            toast.success("Service group updated");
        } catch {
            toast.error("Failed to update service group");
        } finally {
            setSGSubmitting(false);
        }
    };

    const handleDeleteSG = async (id: string) => {
        try {
            await reqDeleteServiceGroup(id);
            fetchServiceGroups();
            toast.success("Service group deleted");
        } catch {
            toast.error("Failed to delete service group");
        }
    };

    // ─── Channel Helpers ───

    const handleCreateChannel = async (name: string, type: string, config: string) => {
        setChannelSubmitting(true);
        try {
            await reqCreateNotificationChannel(name, type, config);
            setShowChannelForm(false);
            fetchChannels();
            toast.success("Channel created");
        } catch {
            toast.error("Failed to create channel");
        } finally {
            setChannelSubmitting(false);
        }
    };

    const handleDeleteChannel = async (id: string) => {
        try {
            await reqDeleteNotificationChannel(id);
            fetchChannels();
            toast.success("Channel deleted");
        } catch {
            toast.error("Failed to delete channel");
        }
    };

    const handleTestChannel = async (id: string) => {
        setTestingChannelId(id);
        try {
            await reqTestNotificationChannel(id);
            toast.success("Test notification sent");
            setTestedChannels((prev) => {
                const next = new Map(prev);
                next.set(id, { success: true, time: new Date() });
                return next;
            });
        } catch {
            toast.error("Failed to send test notification");
            setTestedChannels((prev) => {
                const next = new Map(prev);
                next.set(id, { success: false, time: new Date() });
                return next;
            });
        } finally {
            setTimeout(() => setTestingChannelId(null), 1000);
        }
    };

    // ─── Desktop Helpers ───

    const handleToggleDesktop = async () => {
        if (!desktopEnabled && notifPermission !== "granted") {
            const perm = await requestNotificationPermission();
            setNotifPermission(perm);
            if (perm !== "granted") return;
        }
        const next = !desktopEnabled;
        setDesktopNotificationsEnabled(next);
        setDesktopEnabled(next);
    };

    // ─── Render Helpers ───

    function toggleExpandPolicy(id: string) {
        setExpandedPolicies((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    function renderMatcherBadges(policy: NotificationPolicy) {
        const matchers = parseJsonSafe<PolicyMatchers>(policy.matchers, {});
        const badges: React.ReactNode[] = [];

        if (matchers.priority && ["P0", "P1", "P2", "P3"].includes(matchers.priority)) {
            const priority = matchers.priority as AlertPriority;
            const label = PRIORITY_LABELS[priority] || priority;
            const color = PRIORITY_COLORS[priority] || "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
            badges.push(
                <span key="priority" className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
                    {priority} {label}
                </span>
            );
        }

        if (matchers.services && matchers.services.length > 0) {
            matchers.services.forEach((svc, i) => {
                badges.push(
                    <span key={`svc-${i}`} className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {svc}
                    </span>
                );
            });
        }

        if (matchers.service_group) {
            const sg = serviceGroups.find((g) => g.id === matchers.service_group);
            badges.push(
                <span key="sg" className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {sg ? sg.name : "group"}
                </span>
            );
        }

        if (matchers.status) {
            const statusColor =
                matchers.status === "firing"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
            badges.push(
                <span key="status" className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                    {matchers.status}
                </span>
            );
        }

        if (matchers.env) {
            badges.push(
                <span key="env" className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {matchers.env}
                </span>
            );
        }

        if (matchers.rule_name) {
            badges.push(
                <span key="rule" className="rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    rule: {matchers.rule_name}
                </span>
            );
        }

        if (badges.length === 0) {
            badges.push(
                <span key="any" className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    all alerts
                </span>
            );
        }

        return badges;
    }

    function getChannelCount(policy: NotificationPolicy): number {
        const ids = parseJsonSafe<string[]>(policy.channel_ids, []);
        return ids.length;
    }

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
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

                {/* Policies Tab -- Pipeline Visualization */}
                {activeTab === "policies" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Policies are evaluated top-to-bottom. The first match wins unless &quot;continue matching&quot; is set.
                            </p>
                            <button
                                onClick={() => setShowPolicyForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Policy
                            </button>
                        </div>

                        {policiesLoading ? (
                            <div className="flex items-center justify-center py-16">
                                <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                            </div>
                        ) : policies.length === 0 ? (
                            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                    <p className="text-sm font-medium">No notification policies</p>
                                    <p className="text-xs mt-1">Create your first policy to route alerts to channels.</p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                {policies.map((policy, index) => {
                                    const matchers = parseJsonSafe<PolicyMatchers>(policy.matchers, {});
                                    const channelCount = getChannelCount(policy);
                                    const matchingRuleCount = getRulesMatchingPolicy(policy, alertRules);
                                    const summary = buildMatcherSummary(matchers, serviceGroups);
                                    const isExpanded = expandedPolicies.has(policy.id);
                                    const barColor = priorityBarColor(matchers);
                                    const isLast = index === policies.length - 1;

                                    return (
                                        <div key={policy.id}>
                                            {/* Policy card row: position circle + priority bar + content */}
                                            <div className="flex items-stretch gap-3">
                                                {/* Position circle */}
                                                <div className="flex flex-col items-center pt-3.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                                        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{index + 1}</span>
                                                    </div>
                                                </div>

                                                {/* Card with priority left border */}
                                                <div
                                                    className={`flex-1 min-w-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm border-l-4 ${barColor} transition-colors ${
                                                        !policy.enabled ? "opacity-60" : ""
                                                    }`}
                                                >
                                                    <div className="px-4 py-3">
                                                        {/* Top row: name + badges + actions */}
                                                        <div className="flex items-center gap-2 justify-between">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                                    {policy.name}
                                                                </span>
                                                                {policy.is_default && (
                                                                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 shrink-0">
                                                                        System
                                                                    </span>
                                                                )}
                                                                {!policy.enabled && (
                                                                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 shrink-0">
                                                                        disabled
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button
                                                                    onClick={() => handleMovePolicy(index, "up")}
                                                                    disabled={index === 0}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move up"
                                                                >
                                                                    <FontAwesomeIcon icon={faArrowUp} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleMovePolicy(index, "down")}
                                                                    disabled={isLast}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move down"
                                                                >
                                                                    <FontAwesomeIcon icon={faArrowDown} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleTogglePolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title={policy.enabled ? "Disable" : "Enable"}
                                                                >
                                                                    <FontAwesomeIcon
                                                                        icon={policy.enabled ? faToggleOn : faToggleOff}
                                                                        className={`text-base ${policy.enabled ? "text-emerald-500" : ""}`}
                                                                    />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDuplicatePolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title="Duplicate"
                                                                >
                                                                    <FontAwesomeIcon icon={faCopy} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingPolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title="Edit"
                                                                >
                                                                    <FontAwesomeIcon icon={faPen} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (policy.is_default) return;
                                                                        setConfirmAction({
                                                                            title: "Delete Policy",
                                                                            message: `Are you sure you want to delete "${policy.name}"? This action cannot be undone.`,
                                                                            onConfirm: () => {
                                                                                handleDeletePolicy(policy.id);
                                                                                setConfirmAction(null);
                                                                            },
                                                                        });
                                                                    }}
                                                                    disabled={policy.is_default}
                                                                    className="p-1.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title={policy.is_default ? "Cannot delete default policy" : "Delete"}
                                                                >
                                                                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Second row: matching rules + channel count */}
                                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                                            Matches {matchingRuleCount} rule{matchingRuleCount !== 1 ? "s" : ""}
                                                            {" · "}
                                                            {channelCount} channel{channelCount !== 1 ? "s" : ""}
                                                        </p>

                                                        {/* Third row: compact matcher summary with expand toggle */}
                                                        <div className="mt-1.5 flex items-center gap-1.5">
                                                            <button
                                                                onClick={() => toggleExpandPolicy(policy.id)}
                                                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                                            >
                                                                <FontAwesomeIcon
                                                                    icon={isExpanded ? faChevronDown : faChevronRight}
                                                                    className="text-[10px]"
                                                                />
                                                            </button>
                                                            {summary ? (
                                                                <button
                                                                    onClick={() => toggleExpandPolicy(policy.id)}
                                                                    className="text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors text-left"
                                                                >
                                                                    {summary}
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => toggleExpandPolicy(policy.id)}
                                                                    className="text-xs text-zinc-400 dark:text-zinc-500 italic hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                                                >
                                                                    All alerts
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Expanded badges */}
                                                        {isExpanded && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
                                                                {renderMatcherBadges(policy)}
                                                            </div>
                                                        )}

                                                        {/* Continue matching / stops indicator */}
                                                        {policy.continue_matching ? (
                                                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-500 dark:text-blue-400">
                                                                <FontAwesomeIcon icon={faChevronDown} className="text-[9px]" />
                                                                <span>continues</span>
                                                            </div>
                                                        ) : (
                                                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-350 dark:text-zinc-600">
                                                                <span className="inline-block w-2 h-2 rounded-sm bg-zinc-300 dark:bg-zinc-600" />
                                                                <span>stops</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Connector line between cards */}
                                            {!isLast && (
                                                <div className="flex items-center pl-[11px] h-6">
                                                    <div className="w-px h-full border-l-2 border-dashed border-zinc-300 dark:border-zinc-600" />
                                                </div>
                                            )}

                                            {/* Catch-all note after the last policy */}
                                            {isLast && (
                                                <p className="text-xs text-zinc-400 dark:text-zinc-500 italic mt-3 pl-9">
                                                    Alerts not matching any policy above will use direct channel assignments
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Service Groups Tab */}
                {activeTab === "service-groups" && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowSGForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Group
                            </button>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {serviceGroupsLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : serviceGroups.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    <p className="text-sm font-medium">No service groups</p>
                                    <p className="text-xs mt-1">Group services together for easier policy targeting.</p>
                                </div>
                            ) : (
                                <div>
                                    {serviceGroups.map((sg) => {
                                        const services = parseJsonSafe<string[]>(sg.services, []);
                                        return (
                                            <div
                                                key={sg.id}
                                                className="flex items-center gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {sg.name}
                                                        </span>
                                                    </div>
                                                    {sg.description && (
                                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                                                            {sg.description}
                                                        </p>
                                                    )}
                                                    <div className="flex flex-wrap gap-1">
                                                        {services.map((svc) => (
                                                            <span
                                                                key={svc}
                                                                className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                                            >
                                                                {svc}
                                                            </span>
                                                        ))}
                                                        {services.length === 0 && (
                                                            <span className="text-xs text-zinc-400 italic">No services</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => setEditingSG(sg)}
                                                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Edit"
                                                    >
                                                        <FontAwesomeIcon icon={faPen} className="text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setConfirmAction({
                                                                title: "Delete Service Group",
                                                                message: `Are you sure you want to delete "${sg.name}"? This action cannot be undone.`,
                                                                onConfirm: () => {
                                                                    handleDeleteSG(sg.id);
                                                                    setConfirmAction(null);
                                                                },
                                                            });
                                                        }}
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

                {/* Channels Tab */}
                {activeTab === "channels" && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowChannelForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Channel
                            </button>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {channelsLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : channels.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                                    </svg>
                                    <p className="text-sm font-medium">No notification channels</p>
                                    <p className="text-xs mt-1">Create a channel to receive alert notifications.</p>
                                </div>
                            ) : (
                                <div>
                                    {channels.map((ch) => {
                                        let configDisplay = "";
                                        try {
                                            const parsed = JSON.parse(ch.config);
                                            if (ch.type === "pagerduty") configDisplay = `Severity: ${parsed.severity || "critical"}`;
                                            else if (ch.type === "email") configDisplay = parsed.to || parsed.smtp_host || ch.config;
                                            else configDisplay = parsed.url || parsed.webhook_url || ch.config;
                                        } catch {
                                            configDisplay = ch.config;
                                        }

                                        const isTesting = testingChannelId === ch.id;
                                        const testResult = testedChannels.get(ch.id);

                                        return (
                                            <div
                                                key={ch.id}
                                                className="flex items-center gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                {/* Type icon */}
                                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${typeBadgeClass(ch.type)}`}>
                                                    {channelTypeIcon(ch.type)}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5">
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {ch.name}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(ch.type)}`}>
                                                            {ch.type}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                        {configDisplay}
                                                    </p>
                                                </div>

                                                {/* Channel health indicator */}
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {testResult ? (
                                                        <>
                                                            <div className={`w-2 h-2 rounded-full ${testResult.success ? "bg-emerald-500" : "bg-red-500"}`} />
                                                            <span className={`text-xs ${testResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                                                {testResult.success ? `Tested ${getTimeAgo(testResult.time)}` : `Test failed ${getTimeAgo(testResult.time)}`}
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                                                            <span className="text-xs text-zinc-400 dark:text-zinc-500">Untested</span>
                                                        </>
                                                    )}
                                                </div>

                                                <button
                                                    onClick={() => handleTestChannel(ch.id)}
                                                    disabled={isTesting}
                                                    className="p-2 text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0 disabled:opacity-50"
                                                    title="Send test notification"
                                                >
                                                    <FontAwesomeIcon icon={isTesting ? faSpinner : faPaperPlane} className={`text-sm ${isTesting ? "animate-spin" : ""}`} />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setConfirmAction({
                                                            title: "Delete Channel",
                                                            message: `Are you sure you want to delete "${ch.name}"? This action cannot be undone.`,
                                                            onConfirm: () => {
                                                                handleDeleteChannel(ch.id);
                                                                setConfirmAction(null);
                                                            },
                                                        });
                                                    }}
                                                    className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                                                    title="Delete"
                                                >
                                                    <FontAwesomeIcon icon={faTrash} className="text-sm" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Desktop Notifications Tab */}
                {activeTab === "desktop" && (
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
                )}
            </div>

            {/* Modals */}
            {showPolicyForm && (
                <PolicyFormModal
                    title="Create Policy"
                    onClose={() => setShowPolicyForm(false)}
                    onSubmit={handleCreatePolicy}
                    submitting={policySubmitting}
                    channels={channels}
                    serviceGroups={serviceGroups}
                    alertRules={alertRules}
                />
            )}
            {editingPolicy && (
                <PolicyFormModal
                    title="Edit Policy"
                    initial={policyToFormData(editingPolicy)}
                    onClose={() => setEditingPolicy(null)}
                    onSubmit={handleEditPolicy}
                    submitting={policySubmitting}
                    channels={channels}
                    serviceGroups={serviceGroups}
                    alertRules={alertRules}
                />
            )}
            {showSGForm && (
                <ServiceGroupFormModal
                    title="Create Service Group"
                    onClose={() => setShowSGForm(false)}
                    onSubmit={handleCreateSG}
                    submitting={sgSubmitting}
                />
            )}
            {editingSG && (
                <ServiceGroupFormModal
                    title="Edit Service Group"
                    initial={{
                        name: editingSG.name,
                        description: editingSG.description,
                        services: parseJsonSafe<string[]>(editingSG.services, []).join("\n"),
                    }}
                    onClose={() => setEditingSG(null)}
                    onSubmit={handleEditSG}
                    submitting={sgSubmitting}
                />
            )}
            {showChannelForm && (
                <ChannelFormModal
                    onClose={() => setShowChannelForm(false)}
                    onSubmit={handleCreateChannel}
                    submitting={channelSubmitting}
                />
            )}
            {confirmAction && (
                <ConfirmModal
                    title={confirmAction.title}
                    message={confirmAction.message}
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => setConfirmAction(null)}
                />
            )}
        </main>
    );
}
