"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faPlus,
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
import { reportError } from "@/services/monitor.service";
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
    reqUpdateNotificationChannel,
    reqTestNotificationChannel,
    reqListAlertRules,
} from "@/services/api";
import { FailureState, FailureNote } from "@/components/FailureState";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
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
        // Silent on purpose: the caller's fallback IS the handling, and this runs during render.
        return fallback;
    }
}

/** Given a policy, count how many alert rules would match it. */
function getRulesMatchingPolicy(policy: NotificationPolicy, rules: AlertRule[]): number {
    let matchers: PolicyMatchers;
    try {
        matchers = JSON.parse(policy.matchers);
    } catch {
        // Silent on purpose: an unparseable policy counts zero in this per-render preview only.
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
            /* silent on purpose: a malformed stored filter only widens this per-render preview */
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
        <Modal open onClose={onClose} title={title} widthClass="max-w-lg" dismissible={!submitting}>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="nf-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input id="nf-name"
                            type="text"
                            value={form.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            required
                            className={INPUT_CLASS}
                            placeholder="e.g. Critical PagerDuty"
                        />
                    </div>
                    <div>
                        <label htmlFor="nf-description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                        <input id="nf-description"
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
                                <label htmlFor="nf-priority" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Priority</label>
                                <select id="nf-priority"
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
                                <label htmlFor="nf-status" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                                <select id="nf-status"
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
                                <label htmlFor="nf-services" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Services</label>
                                <input id="nf-services"
                                    type="text"
                                    value={form.services}
                                    onChange={(e) => handleChange("services", e.target.value)}
                                    className={INPUT_CLASS}
                                    placeholder="Comma-separated service names"
                                />
                                <p className="text-xs text-zinc-400 mt-1">e.g. keyring-api, lattice-api, monitor-core</p>
                            </div>

                            <div>
                                <label htmlFor="nf-service-group" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Service Group</label>
                                <select id="nf-service-group"
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
                                    <label htmlFor="nf-environment" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Environment</label>
                                    <input id="nf-environment"
                                        type="text"
                                        value={form.env}
                                        onChange={(e) => handleChange("env", e.target.value)}
                                        className={INPUT_CLASS}
                                        placeholder="e.g. production"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="nf-rule-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Rule Name</label>
                                    <input id="nf-rule-name"
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
        </Modal>
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
    };

    return (
        <Modal open onClose={onClose} title={title} widthClass="max-w-md" dismissible={!submitting}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="nf-name-2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input id="nf-name-2"
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            required
                            className={INPUT_CLASS}
                            placeholder="e.g. Production Services"
                        />
                    </div>
                    <div>
                        <label htmlFor="nf-description-2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                        <input id="nf-description-2"
                            type="text"
                            value={form.description}
                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            className={INPUT_CLASS}
                            placeholder="Optional description"
                        />
                    </div>
                    <div>
                        <label htmlFor="nf-services-2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Services</label>
                        <textarea id="nf-services-2"
                            value={form.services}
                            onChange={(e) => setForm((prev) => ({ ...prev, services: e.target.value }))}
                            rows={4}
                            className={INPUT_CLASS}
                            placeholder={"One service per line, or comma-separated:\nkeyring-api\nlattice-api\nmonitor-core"}
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
        </Modal>
    );
}

// ─── Channel Form Modal ───

interface ChannelFormModalProps {
    /** The channel being edited; absent for a new one. */
    initial?: NotificationChannel;
    onClose: () => void;
    /** `config` is undefined on an edit that leaves the credential alone. */
    onSubmit: (name: string, type: string, config: string | undefined) => void;
    submitting: boolean;
}

/**
 * Create or edit a channel.
 *
 * ⚠️ AN EDIT NEVER SEES THE STORED CREDENTIAL — monitor-core does not send it
 * (see the guard on NotificationChannel). So on edit the credential fields start
 * empty and mean "replace": left empty, the PUT omits `config` and the server
 * keeps what it has. Changing the TYPE requires new credentials, because the
 * stored ones belong to the old type's notifier.
 */
function ChannelFormModal({ initial, onClose, onSubmit, submitting }: ChannelFormModalProps) {
    const isEdit = Boolean(initial);
    const [name, setName] = useState(initial?.name ?? "");
    const [type, setType] = useState<string>(initial?.type ?? "webhook");

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

    // On edit, did the user type any credential? Untouched means "keep".
    const credentialsTouched = Boolean(
        webhookUrl || slackWebhookUrl || smtpHost || smtpUsername || smtpPassword || fromEmail || fromName || emailTo || routingKey,
    );
    const typeChanged = isEdit && type !== initial?.type;
    // Fields are only `required` when their value will actually be sent.
    const credsRequired = !isEdit || typeChanged || credentialsTouched;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(name, type, isEdit && !typeChanged && !credentialsTouched ? undefined : buildConfig());
    };

    return (
        <Modal open onClose={onClose} title={initial ? `Edit “${initial.name}”` : "Create Channel"} widthClass="max-w-md" dismissible={!submitting}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="nf-name-3" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input id="nf-name-3" type="text" value={name} onChange={(e) => setName(e.target.value)} required className={INPUT_CLASS} placeholder="e.g. Production Alerts" />
                    </div>
                    <div>
                        <label htmlFor="nf-type" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
                        <select id="nf-type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT_CLASS}>
                            <option value="webhook">Webhook</option>
                            <option value="slack">Slack</option>
                            <option value="email">Email (SMTP)</option>
                            <option value="pagerduty">PagerDuty</option>
                        </select>
                    </div>
                    {isEdit && (
                        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                            {typeChanged
                                ? "A new type needs new credentials — the stored ones belong to the old type."
                                : <>Currently sending to <span className="font-medium text-zinc-700 dark:text-zinc-300">{initial?.config_summary || "—"}</span>. Leave the fields below empty to keep the stored credentials; anything you enter replaces them.</>}
                        </p>
                    )}

                    {type === "webhook" && (
                        <div>
                            <label htmlFor="nf-webhook-url" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Webhook URL</label>
                            <input id="nf-webhook-url" type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="https://example.com/webhook" />
                        </div>
                    )}

                    {type === "slack" && (
                        <div>
                            <label htmlFor="nf-slack-webhook-url" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Slack Webhook URL</label>
                            <input id="nf-slack-webhook-url" type="url" value={slackWebhookUrl} onChange={(e) => setSlackWebhookUrl(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="https://hooks.slack.com/services/..." />
                        </div>
                    )}

                    {type === "email" && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-smtp-host" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">SMTP Host</label>
                                    <input id="nf-smtp-host" type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="smtp.gmail.com" />
                                </div>
                                <div>
                                    <label htmlFor="nf-smtp-port" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">SMTP Port</label>
                                    <input id="nf-smtp-port" type="text" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={INPUT_CLASS} placeholder="587" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-username" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Username</label>
                                    <input id="nf-username" type="text" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} className={INPUT_CLASS} />
                                </div>
                                <div>
                                    <label htmlFor="nf-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Password</label>
                                    <input id="nf-password" type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} className={INPUT_CLASS} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-from-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">From Email</label>
                                    <input id="nf-from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={INPUT_CLASS} placeholder="alerts@example.com" />
                                </div>
                                <div>
                                    <label htmlFor="nf-from-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">From Name</label>
                                    <input id="nf-from-name" type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} className={INPUT_CLASS} placeholder="Monitor Alerts" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="nf-recipients" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Recipients</label>
                                <input id="nf-recipients" type="text" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="user@example.com, user2@example.com" />
                                <p className="text-xs text-zinc-400 mt-1">Comma-separated email addresses</p>
                            </div>
                        </>
                    )}

                    {type === "pagerduty" && (
                        <>
                            <div>
                                <label htmlFor="nf-integration-key-routing-key" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Integration Key (Routing Key)</label>
                                <input id="nf-integration-key-routing-key" type="text" value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="Events API v2 integration key" />
                                <p className="text-xs text-zinc-400 mt-1">From your PagerDuty service&apos;s Events API v2 integration</p>
                            </div>
                            <div>
                                <label htmlFor="nf-default-severity" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Default Severity</label>
                                <select id="nf-default-severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={INPUT_CLASS}>
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
                            {submitting ? <FontAwesomeIcon icon={faSpinner} className="animate-spin" /> : isEdit ? "Save" : "Create"}
                        </button>
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                            Cancel
                        </button>
                    </div>
                </form>
        </Modal>
    );
}

// ─── Main Page ───

function Notifications() {
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
    const [policiesError, setPoliciesError] = useState<string | null>(null);
    const [showPolicyForm, setShowPolicyForm] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<NotificationPolicy | null>(null);
    const [policySubmitting, setPolicySubmitting] = useState(false);

    // Service Groups
    const [serviceGroups, setServiceGroups] = useState<ServiceGroup[]>([]);
    const [serviceGroupsLoading, setServiceGroupsLoading] = useState(true);
    const [serviceGroupsError, setServiceGroupsError] = useState<string | null>(null);
    const [showSGForm, setShowSGForm] = useState(false);
    const [editingSG, setEditingSG] = useState<ServiceGroup | null>(null);
    const [sgSubmitting, setSGSubmitting] = useState(false);

    // Channels
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    const [channelsLoading, setChannelsLoading] = useState(false);
    const [channelsError, setChannelsError] = useState<string | null>(null);
    const [showChannelForm, setShowChannelForm] = useState(false);
    const [channelSubmitting, setChannelSubmitting] = useState(false);
    const [testingChannelId, setTestingChannelId] = useState<string | null>(null);

    // Channel health indicators
    const [testedChannels, setTestedChannels] = useState<Map<string, { success: boolean; time: Date }>>(new Map());
    // Force re-render for time-ago updates
    const [, setTick] = useState(0);

    // Alert rules (for connected alerts count)
    const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
    const [alertRulesError, setAlertRulesError] = useState<string | null>(null);

    // Expandable matcher detail per policy
    const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());

    const confirm = useConfirm();
    const { canWrite } = useRole();
    const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const policyIds = useMemo(() => policies.map((p) => p.id), [policies]);
    const groupIds = useMemo(() => serviceGroups.map((g) => g.id), [serviceGroups]);
    const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);
    const policySel = useSelection(policyIds);
    const groupSel = useSelection(groupIds);
    const channelSel = useSelection(channelIds);

    // Tick every 30s to keep time-ago labels fresh
    useEffect(() => {
        const interval = setInterval(() => setTick((t) => t + 1), 30000);
        return () => clearInterval(interval);
    }, []);

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
            const res = await reqCreatePolicy(buildPolicyPayload(form));
            if (!res.success) {
                toast.error(res.error_message || "Failed to create policy");
                return;
            }
            setShowPolicyForm(false);
            fetchPolicies();
            toast.success("Policy created");
        } catch (err) {
            reportError("notification_policy.create.failed", err, {
                outcome: "policy not created; user toasted",
            });
            toast.error("Failed to create policy");
        } finally {
            setPolicySubmitting(false);
        }
    };

    const handleEditPolicy = async (form: PolicyFormData) => {
        if (!editingPolicy) return;
        setPolicySubmitting(true);
        try {
            const res = await reqUpdatePolicy(editingPolicy.id, buildPolicyPayload(form));
            if (!res.success) {
                toast.error(res.error_message || "Failed to update policy");
                return;
            }
            setEditingPolicy(null);
            fetchPolicies();
            toast.success("Policy updated");
        } catch (err) {
            reportError("notification_policy.save.failed", err, {
                policy_id: editingPolicy?.id,
                outcome: "policy edit not saved; user toasted",
            });
            toast.error("Failed to update policy");
        } finally {
            setPolicySubmitting(false);
        }
    };

    const confirmDeletePolicy = async (policy: NotificationPolicy) => {
        if (policy.is_default) return;
        const ok = await confirm({
            title: `Delete “${policy.name}”?`,
            description: "Alerts this policy matched fall through to the next policy in order — or to none.",
            confirmLabel: "Delete policy",
            destructive: true,
        });
        if (ok) await handleDeletePolicy(policy.id);
    };

    const handleDeletePolicy = async (id: string) => {
        try {
            const res = await reqDeletePolicy(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete policy");
                return;
            }
            fetchPolicies();
            toast.success("Policy deleted");
        } catch (err) {
            reportError("notification_policy.delete.failed", err, {
                policy_id: id,
                outcome: "policy kept; user toasted",
            });
            toast.error("Failed to delete policy");
        }
    };

    const handleDuplicatePolicy = async (policy: NotificationPolicy) => {
        try {
            const matchers = policy.matchers;
            const channelIds = policy.channel_ids;
            const res = await reqCreatePolicy({
                name: `${policy.name} (Copy)`,
                description: policy.description,
                matchers,
                channel_ids: channelIds,
                continue_matching: policy.continue_matching,
                enabled: false,
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to duplicate policy");
                return;
            }
            fetchPolicies();
            toast.success("Policy duplicated");
        } catch (err) {
            reportError("notification_policy.duplicate.failed", err, {
                policy_id: policy.id,
                outcome: "no copy created; user toasted",
            });
            toast.error("Failed to duplicate policy");
        }
    };

    const handleTogglePolicy = async (policy: NotificationPolicy) => {
        try {
            const res = await reqUpdatePolicy(policy.id, { enabled: !policy.enabled });
            if (!res.success) {
                toast.error(res.error_message || "Failed to toggle policy");
                return;
            }
            fetchPolicies();
            toast.success(policy.enabled ? "Policy disabled" : "Policy enabled");
        } catch (err) {
            reportError("notification_policy.toggle.failed", err, {
                policy_id: policy.id,
                enabling: !policy.enabled,
                outcome: "policy state unchanged; user toasted",
            });
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
            // The reorder is applied optimistically above and the catch was the
            // rollback. With a non-2xx arriving as a VALUE that catch never ran,
            // so a rejected reorder left the list showing an order the server
            // had refused — and policy order decides which rule wins. Refetching
            // puts the real order back on screen.
            const res = await reqReorderPolicies(reordered.map((p) => p.id));
            if (!res.success) {
                toast.error(res.error_message || "Failed to reorder policies");
                fetchPolicies();
            }
        } catch (err) {
            reportError("notification_policy.reorder.failed", err, {
                outcome: "list refetched to show the server's order",
            });
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
            const res = await reqCreateServiceGroup({
                name: form.name,
                description: form.description,
                services: JSON.stringify(parseServicesList(form.services)),
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to create service group");
                return;
            }
            setShowSGForm(false);
            fetchServiceGroups();
            toast.success("Service group created");
        } catch (err) {
            reportError("service_group.create.failed", err, {
                outcome: "service group not created; user toasted",
            });
            toast.error("Failed to create service group");
        } finally {
            setSGSubmitting(false);
        }
    };

    const handleEditSG = async (form: ServiceGroupFormData) => {
        if (!editingSG) return;
        setSGSubmitting(true);
        try {
            const res = await reqUpdateServiceGroup(editingSG.id, {
                name: form.name,
                description: form.description,
                services: JSON.stringify(parseServicesList(form.services)),
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to update service group");
                return;
            }
            setEditingSG(null);
            fetchServiceGroups();
            toast.success("Service group updated");
        } catch (err) {
            reportError("service_group.save.failed", err, {
                service_group_id: editingSG?.id,
                outcome: "service group edit not saved; user toasted",
            });
            toast.error("Failed to update service group");
        } finally {
            setSGSubmitting(false);
        }
    };

    const confirmDeleteSG = async (sg: ServiceGroup) => {
        const users = policiesReferencingGroup(sg.id).map((p) => p.name);
        const ok = await confirm({
            title: `Delete “${sg.name}”?`,
            description: users.length
                ? `Still targeted by ${users.length} polic${users.length === 1 ? "y" : "ies"}: ${users.join(", ")}. Those matchers will stop matching anything through this group.`
                : "No policy targets this group.",
            confirmLabel: "Delete group",
            destructive: true,
        });
        if (ok) await handleDeleteSG(sg.id);
    };

    const handleDeleteSG = async (id: string) => {
        try {
            const res = await reqDeleteServiceGroup(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete service group");
                return;
            }
            fetchServiceGroups();
            toast.success("Service group deleted");
        } catch (err) {
            reportError("service_group.delete.failed", err, {
                service_group_id: id,
                outcome: "service group kept; user toasted",
            });
            toast.error("Failed to delete service group");
        }
    };

    // ─── Channel Helpers ───

    const handleCreateChannel = async (name: string, type: string, config: string | undefined) => {
        setChannelSubmitting(true);
        try {
            const res = await reqCreateNotificationChannel(name, type, config ?? "{}");
            if (!res.success) {
                toast.error(res.error_message || "Failed to create channel");
                return;
            }
            setShowChannelForm(false);
            fetchChannels();
            toast.success("Channel created");
        } catch (err) {
            // The channel TYPE only — its config is the credential and never leaves the form.
            reportError("notification_channel.create.failed", err, {
                channel_type: type,
                outcome: "channel not created; user toasted",
            });
            toast.error("Failed to create channel");
        } finally {
            setChannelSubmitting(false);
        }
    };

    // Nothing server-side cleans up a deleted channel's id out of the policies
    // that route to it (see query.DeleteNotificationChannel): the alert is then
    // silently undelivered. So the confirmation names who still sends here.
    const policiesUsingChannel = (channelId: string) =>
        policies.filter((p) => parseJsonSafe<string[]>(p.channel_ids, []).includes(channelId));

    const policiesReferencingGroup = (groupId: string) =>
        policies.filter((p) => {
            const m = parseJsonSafe<PolicyMatchers>(p.matchers, {});
            return m.service_group === groupId;
        });

    const confirmDeleteChannel = async (ch: NotificationChannel) => {
        const users = policiesUsingChannel(ch.id).map((p) => p.name);
        const ok = await confirm({
            title: `Delete “${ch.name}”?`,
            description: users.length
                ? `${users.length} polic${users.length === 1 ? "y routes" : "ies route"} to this channel: ${users.join(", ")}. Their alerts will no longer be delivered here — edit them first if this is their only channel.`
                : "No policy routes to this channel.",
            confirmLabel: "Delete channel",
            destructive: true,
        });
        if (ok) await handleDeleteChannel(ch.id);
    };

    const handleEditChannel = async (name: string, type: string, config: string | undefined) => {
        if (!editingChannel) return;
        setChannelSubmitting(true);
        const patch: { name?: string; type?: string; config?: string } = {};
        if (name !== editingChannel.name) patch.name = name;
        if (type !== editingChannel.type) patch.type = type;
        if (config !== undefined) patch.config = config;
        if (Object.keys(patch).length === 0) {
            setChannelSubmitting(false);
            setEditingChannel(null);
            return;
        }
        const res = await reqUpdateNotificationChannel(editingChannel.id, patch);
        setChannelSubmitting(false);
        if (!res.success) {
            toast.error(res.error_message || "Failed to update channel");
            return;
        }
        setEditingChannel(null);
        fetchChannels();
        toast.success(config !== undefined ? "Channel updated — send a test to confirm the new credentials" : "Channel updated");
    };

    const handleDeleteChannel = async (id: string) => {
        try {
            const res = await reqDeleteNotificationChannel(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete channel");
                return;
            }
            fetchChannels();
            toast.success("Channel deleted");
        } catch (err) {
            reportError("notification_channel.delete.failed", err, {
                channel_id: id,
                outcome: "channel kept; user toasted",
            });
            toast.error("Failed to delete channel");
        }
    };

    const handleTestChannel = async (id: string) => {
        setTestingChannelId(id);
        try {
            // The green tick this writes is a HEALTH INDICATOR that persists on
            // the row. Recording success for a rejected test is worse than any
            // empty state on this page: it is durable, and it is the exact
            // signal an operator checks before trusting a channel.
            const res = await reqTestNotificationChannel(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to send test notification");
                setTestedChannels((prev) => {
                    const next = new Map(prev);
                    next.set(id, { success: false, time: new Date() });
                    return next;
                });
                return;
            }
            toast.success("Test notification sent");
            setTestedChannels((prev) => {
                const next = new Map(prev);
                next.set(id, { success: true, time: new Date() });
                return next;
            });
        } catch (err) {
            reportError("notification_channel.test.failed", err, {
                channel_id: id,
                outcome: "channel marked as failed test; user toasted",
            });
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

    // ─── Bulk ───

    const bulkPoliciesEnabled = async (enabled: boolean) => {
        const targets = policies.filter((p) => policySel.isSelected(p.id) && p.enabled !== enabled);
        if (targets.length === 0) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (p) => reqUpdatePolicy(p.id, { enabled }));
        setBulkBusy(false);
        toastBulkResult(result, enabled ? "Enabled" : "Disabled", "policy");
        fetchPolicies();
    };

    const bulkDeletePolicies = async () => {
        const selected = policies.filter((p) => policySel.isSelected(p.id));
        const targets = selected.filter((p) => !p.is_default);
        const skipped = selected.length - targets.length;
        if (targets.length === 0) {
            toast.error("System policies cannot be deleted");
            return;
        }
        const ok = await confirm({
            title: `Delete ${targets.length} polic${targets.length === 1 ? "y" : "ies"}?`,
            description: `${targets.map((p) => p.name).join(", ")}.${skipped ? ` ${skipped} system polic${skipped === 1 ? "y is" : "ies are"} skipped.` : ""} Alerts they matched fall through to the next policy in order.`,
            confirmLabel: `Delete ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (p) => reqDeletePolicy(p.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "policy");
        policySel.clear();
        fetchPolicies();
    };

    const bulkDeleteGroups = async () => {
        const targets = serviceGroups.filter((g) => groupSel.isSelected(g.id));
        const inUse = targets.filter((g) => policiesReferencingGroup(g.id).length > 0).map((g) => g.name);
        const ok = await confirm({
            title: `Delete ${targets.length} service group${targets.length === 1 ? "" : "s"}?`,
            description: inUse.length
                ? `Still targeted by policies: ${inUse.join(", ")}. Those matchers will stop matching through these groups.`
                : "No policy targets these groups.",
            confirmLabel: `Delete ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (g) => reqDeleteServiceGroup(g.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "group");
        groupSel.clear();
        fetchServiceGroups();
    };

    const bulkTestChannels = async () => {
        const targets = channels.filter((c) => channelSel.isSelected(c.id));
        setBulkBusy(true);
        // Sequential on purpose: each test SENDS a real notification, and a
        // burst at one PagerDuty service can trip its rate limit.
        for (const c of targets) {
            await handleTestChannel(c.id);
        }
        setBulkBusy(false);
    };

    const bulkDeleteChannels = async () => {
        const targets = channels.filter((c) => channelSel.isSelected(c.id));
        const affected = new Set(targets.flatMap((c) => policiesUsingChannel(c.id).map((p) => p.name)));
        const ok = await confirm({
            title: `Delete ${targets.length} channel${targets.length === 1 ? "" : "s"}?`,
            description: affected.size
                ? `Policies still routing here: ${[...affected].join(", ")}. Their alerts will no longer be delivered to these channels.`
                : "No policy routes to these channels.",
            confirmLabel: `Delete ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (c) => reqDeleteNotificationChannel(c.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "channel");
        channelSel.clear();
        fetchChannels();
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

                {/* Policies Tab -- Pipeline Visualization */}
                {activeTab === "policies" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Policies are evaluated top-to-bottom. The first match wins unless &quot;continue matching&quot; is set.
                            </p>
                            <div className="flex items-center gap-3">
                                {/* Partial: the policies themselves loaded, only
                                    the matching-rules preview is missing. A note
                                    beside working data, not a panel over it. */}
                                {alertRulesError && (
                                    <FailureNote
                                        what="matching alert rules"
                                        message={alertRulesError}
                                        onRetry={fetchAlertRules}
                                    />
                                )}
                                {canWrite && (
                                <button
                                    onClick={() => setShowPolicyForm(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                >
                                    <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                    Create Policy
                                </button>
                                )}
                            </div>
                        </div>

                        {policiesLoading ? (
                            <div className="flex items-center justify-center py-16">
                                <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                            </div>
                        ) : policiesError ? (
                            /* Replaces the empty state rather than sitting above
                               it: "no policies" tells an operator their alerts
                               route nowhere, which is precisely what a failed
                               read cannot establish. */
                            <FailureState
                                what="notification policies"
                                message={policiesError}
                                onRetry={fetchPolicies}
                            />
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
                                                                {canWrite && (
                                                                    <Checkbox
                                                                        checked={policySel.isSelected(policy.id)}
                                                                        onChange={(e) => policySel.toggle(policy.id, { shiftKey: e.shiftKey })}
                                                                        label={`Select ${policy.name}`}
                                                                    />
                                                                )}
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
                                                            {canWrite && (
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button
                                                                    onClick={() => handleMovePolicy(index, "up")}
                                                                    disabled={index === 0}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move up"
                                                                    aria-label={`Move up ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faArrowUp} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleMovePolicy(index, "down")}
                                                                    disabled={isLast}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move down"
                                                                    aria-label={`Move down ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faArrowDown} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleTogglePolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title={policy.enabled ? "Disable" : "Enable"}
                                                                    aria-label={policy.enabled ? `Disable ${policy.name}` : `Enable ${policy.name}`}
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
                                                                    aria-label={`Duplicate ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faCopy} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingPolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title="Edit"
                                                                    aria-label={`Edit ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faPen} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => void confirmDeletePolicy(policy)}
                                                                    disabled={policy.is_default}
                                                                    className="p-1.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title={policy.is_default ? "Cannot delete default policy" : "Delete"}
                                                                    aria-label={policy.is_default ? "Default policies cannot be deleted" : `Delete ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                                                                </button>
                                                            </div>
                                                            )}
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
                                                                aria-expanded={isExpanded}
                                                                aria-label={`${isExpanded ? "Hide" : "Show"} matchers for ${policy.name}`}
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
                            {canWrite && (
                            <button
                                onClick={() => setShowSGForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Group
                            </button>
                            )}
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {serviceGroupsLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : serviceGroupsError ? (
                                <FailureState
                                    what="service groups"
                                    message={serviceGroupsError}
                                    onRetry={fetchServiceGroups}
                                    className="rounded-none border-0"
                                />
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
                                                {canWrite && (
                                                    <Checkbox
                                                        checked={groupSel.isSelected(sg.id)}
                                                        onChange={(e) => groupSel.toggle(sg.id, { shiftKey: e.shiftKey })}
                                                        label={`Select ${sg.name}`}
                                                    />
                                                )}
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
                                                {canWrite && (
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => setEditingSG(sg)}
                                                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Edit"
                                                        aria-label={`Edit ${sg.name}`}
                                                    >
                                                        <FontAwesomeIcon icon={faPen} className="text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => void confirmDeleteSG(sg)}
                                                        className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Delete"
                                                        aria-label={`Delete ${sg.name}`}
                                                    >
                                                        <FontAwesomeIcon icon={faTrash} className="text-sm" />
                                                    </button>
                                                </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "policies" && (
                    <BulkActionBar count={policySel.count} noun="policy" onClear={policySel.clear}>
                        <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkPoliciesEnabled(true)}>Enable</Button>
                        <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkPoliciesEnabled(false)}>Disable</Button>
                        <Button size="sm" variant="destructive" loading={bulkBusy} onClick={() => void bulkDeletePolicies()}>Delete</Button>
                    </BulkActionBar>
                )}
                {activeTab === "service-groups" && (
                    <BulkActionBar count={groupSel.count} noun="group" onClear={groupSel.clear}>
                        <Button size="sm" variant="destructive" loading={bulkBusy} onClick={() => void bulkDeleteGroups()}>Delete</Button>
                    </BulkActionBar>
                )}

                {/* Channels Tab */}
                {activeTab === "channels" && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            {canWrite && (
                            <button
                                onClick={() => setShowChannelForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Channel
                            </button>
                            )}
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {channelsLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : channelsError ? (
                                <FailureState
                                    what="notification channels"
                                    message={channelsError}
                                    onRetry={fetchChannels}
                                    className="rounded-none border-0"
                                />
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
                                        // ⚠️ THE SUMMARY IS BUILT SERVER-SIDE NOW, and this
                                        // is what used to be here: parse the channel's raw
                                        // config, pick a friendly field out of it, and — on
                                        // every path that failed — fall back to printing the
                                        // WHOLE config. That config is the credential: a
                                        // Slack webhook URL whose path IS the secret, a
                                        // PagerDuty routing key, SMTP settings. So the
                                        // fallback branch of a display helper leaked every
                                        // secret in the zone to anyone who could open this
                                        // tab, and the leak was in the branch nobody tests.
                                        //
                                        // monitor-core now tags the field `json:"-"` and
                                        // sends `config_summary` instead — lossy, host-only,
                                        // failing closed. Read that, never a config.
                                        const configDisplay = ch.config_summary;

                                        const isTesting = testingChannelId === ch.id;
                                        const testResult = testedChannels.get(ch.id);

                                        return (
                                            <div
                                                key={ch.id}
                                                className="flex items-center gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                {canWrite && (
                                                    <Checkbox
                                                        checked={channelSel.isSelected(ch.id)}
                                                        onChange={(e) => channelSel.toggle(ch.id, { shiftKey: e.shiftKey })}
                                                        label={`Select ${ch.name}`}
                                                    />
                                                )}
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

                                                {canWrite && (
                                                <button
                                                    onClick={() => handleTestChannel(ch.id)}
                                                    disabled={isTesting}
                                                    className="p-2 text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0 disabled:opacity-50"
                                                    title="Send test notification"
                                                    aria-label={`Send a test notification to ${ch.name}`}
                                                >
                                                    <FontAwesomeIcon icon={isTesting ? faSpinner : faPaperPlane} className={`text-sm ${isTesting ? "animate-spin" : ""}`} />
                                                </button>
                                                )}
                                                {canWrite && (
                                                <>
                                                <button
                                                    onClick={() => setEditingChannel(ch)}
                                                    className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                                                    title="Edit"
                                                    aria-label={`Edit ${ch.name}`}
                                                >
                                                    <FontAwesomeIcon icon={faPen} className="text-sm" />
                                                </button>
                                                <button
                                                    onClick={() => void confirmDeleteChannel(ch)}
                                                    className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                                                    title="Delete"
                                                    aria-label={`Delete ${ch.name}`}
                                                >
                                                    <FontAwesomeIcon icon={faTrash} className="text-sm" />
                                                </button>
                                                </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "channels" && (
                    <BulkActionBar count={channelSel.count} noun="channel" onClear={channelSel.clear}>
                        <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => void bulkTestChannels()}>Send test</Button>
                        <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => void bulkDeleteChannels()}>Delete</Button>
                    </BulkActionBar>
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
            {editingChannel && (
                <ChannelFormModal
                    key={editingChannel.id}
                    initial={editingChannel}
                    onClose={() => setEditingChannel(null)}
                    onSubmit={handleEditChannel}
                    submitting={channelSubmitting}
                />
            )}
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
