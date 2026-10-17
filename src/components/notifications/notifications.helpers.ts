import {
    NotificationPolicy,
    ServiceGroup,
    PolicyMatchers,
    AlertPriority,
    AlertRule,
    PRIORITY_LABELS,
} from "@/types";

export const INPUT_CLASS =
    "w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

export function typeBadgeClass(type: string): string {
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

export function channelTypeIcon(type: string): string {
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

export function parseJsonSafe<T>(value: string, fallback: T): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        // Silent on purpose: the caller's fallback IS the handling, and this runs during render.
        return fallback;
    }
}

/** Given a policy, count how many alert rules would match it. */
export function getRulesMatchingPolicy(policy: NotificationPolicy, rules: AlertRule[]): number {
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
export function getRulesMatchingFormData(form: PolicyFormData, rules: AlertRule[]): number {
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
export function priorityBarColor(matchers: PolicyMatchers): string {
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
export function buildMatcherSummary(matchers: PolicyMatchers, serviceGroups: ServiceGroup[]): string {
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
export function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

export interface PolicyFormData {
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

export const DEFAULT_POLICY_FORM: PolicyFormData = {
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
