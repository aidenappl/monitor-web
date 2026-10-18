import type {
    AlertRule,
    AlertHistoryEntry,
    AlertPriority,
    AnalyticsFilter,
    NotificationChannel,
    NotificationPolicy,
    PolicyMatchers,
    ServiceGroup,
} from "@/types";
import { eventsHref, type EventsLink } from "@/components/issue/eventsHref";

/**
 * Pure helpers for the alerts page: the routing preview, durations, filter
 * chips and history incidents. No React, no requests.
 */

/** GET /v1/alert-rules also sends the server's own routing verdict per rule. */
export type AlertRuleRow = AlertRule & { has_destinations?: boolean };

export const CONDITION_LABELS: Record<string, string> = {
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
    eq: "=",
};

/** Parses a JSON-array column (`channel_ids`, `notification_channel_ids`), [] when it will not. */
export function parseIdList(raw: string | null | undefined): string[] {
    try {
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id !== "") : [];
    } catch {
        // Silent on purpose: a per-render read of a stored column; an unparseable list is no ids.
        return [];
    }
}

/** A rule's `query_filters`, or [] when the stored JSON is not a filter array. */
export function parseFilters(raw: string | null | undefined): AnalyticsFilter[] {
    try {
        const parsed = JSON.parse(raw || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (f): f is AnalyticsFilter =>
                !!f && typeof f === "object" && typeof f.field === "string" && typeof f.operator === "string",
        );
    } catch {
        // Silent on purpose: runs per render; the form reports invalid JSON where it is typed.
        return [];
    }
}

const OP_LABELS: Record<string, string> = {
    eq: "=",
    neq: "≠",
    lt: "<",
    lte: "≤",
    gt: ">",
    gte: "≥",
    contains: "contains",
    startswith: "starts with",
    endswith: "ends with",
    in: "in",
};

export function describeFilter(f: AnalyticsFilter): string {
    const value = Array.isArray(f.value) ? f.value.join(", ") : String(f.value);
    return `${f.field} ${OP_LABELS[f.operator] ?? f.operator} ${value}`;
}

// ─── Durations ───

export const DURATION_UNITS = [
    { value: "s", label: "seconds", seconds: 1 },
    { value: "m", label: "minutes", seconds: 60 },
    { value: "h", label: "hours", seconds: 3600 },
    { value: "d", label: "days", seconds: 86400 },
] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number]["value"];

export function unitSeconds(unit: DurationUnit): number {
    return DURATION_UNITS.find((u) => u.value === unit)?.seconds ?? 1;
}

/** The largest unit that divides `seconds` exactly, so 900 opens as "15 minutes", not "0.25 hours". */
export function bestUnit(seconds: number): DurationUnit {
    if (seconds > 0 && seconds % 86400 === 0) return "d";
    if (seconds > 0 && seconds % 3600 === 0) return "h";
    if (seconds > 0 && seconds % 60 === 0) return "m";
    return "s";
}

/** 900 → "15m", 5400 → "1h 30m", 0 → "0s". Compact, for rows and sentences. */
export function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}s`;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (sec && !d) parts.push(`${sec}s`);
    return parts.slice(0, 2).join(" ");
}

/** "4m ago", "2h ago" — the relative half of a timestamp. */
export function formatAgo(iso: string, now = Date.now()): string {
    const diff = (now - new Date(iso).getTime()) / 1000;
    if (!Number.isFinite(diff)) return "";
    if (diff < 30) return "just now";
    return `${formatDuration(diff)} ago`;
}

/** The browser's short zone name ("PDT", "GMT+2"), so a table header can say which clock it is. */
export function localZoneName(): string {
    try {
        const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
            .formatToParts(new Date())
            .find((p) => p.type === "timeZoneName");
        return part?.value ?? "local";
    } catch {
        // Silent on purpose: an Intl failure only costs the header its zone label.
        return "local";
    }
}

// ─── Routing preview ───
//
// ⚠️ THIS MIRRORS monitor-core's alerts/router.go (buildAlertContextFrom,
// matchedChannelIDs, matchPolicy) AND MUST STAY IN STEP WITH IT. The preview
// used to list every enabled policy whose matchers passed, ignoring position
// and continue_matching, and treated a rule with no service filter as matching
// service-scoped policies — so it promised routing the evaluator never does.
// The rules, from the Go:
//   - the routable service/env are the FIRST `eq` filter on that field with a
//     string value; anything else (neq, contains, data.*) routes as "no service";
//   - a matcher on a dimension the rule lacks does NOT match ("" ∉ services);
//   - policies are walked in position order; the first match stops the walk
//     unless that policy has continue_matching;
//   - a matched policy with no channels still counts as matched, so the rule's
//     own channels are consulted ONLY when no policy matched at all;
//   - ids that do not resolve to a channel are skipped, not delivered.

export interface RoutingStep {
    policy: NotificationPolicy;
    channels: NotificationChannel[];
    /** Ids this policy names that no longer exist. */
    missing: number;
}

export interface RoutingPreview {
    /** Matched policies in routing order, up to and including the one that stopped the walk. */
    steps: RoutingStep[];
    /** True when no policy matched and the rule's own channels were used. */
    viaRuleChannels: boolean;
    /** Every distinct channel the alert actually reaches. */
    destinations: NotificationChannel[];
    /** Distinct ids (policy or rule) that resolve to no channel. */
    missing: number;
    /** Policies that also match but are never reached because an earlier one stopped the walk. */
    shadowed: NotificationPolicy[];
    /** Enabled policies whose stored JSON will not parse; the router skips them. */
    invalid: NotificationPolicy[];
    service: string;
    env: string;
}

interface RoutingRuleInput {
    name: string;
    priority?: AlertPriority | string;
    query_filters: string;
    notification_channel_ids: string;
}

function routableDimensions(queryFilters: string): { service: string; env: string } {
    let service = "";
    let env = "";
    for (const f of parseFilters(queryFilters)) {
        if (f.operator !== "eq" || typeof f.value !== "string") continue;
        if (f.field === "service" && !service) service = f.value;
        if (f.field === "env" && !env) env = f.value;
    }
    return { service, env };
}

function groupsContaining(groups: ServiceGroup[], service: string): string[] {
    if (!service) return [];
    return groups
        .filter((g) => {
            try {
                const services = JSON.parse(g.services || "[]");
                return Array.isArray(services) && services.includes(service);
            } catch {
                // Silent on purpose: the router skips an unparseable group the same way.
                return false;
            }
        })
        .map((g) => g.id);
}

function matchPolicy(
    m: PolicyMatchers,
    ctx: { priority: string; service: string; env: string; ruleName: string; groupIds: string[] },
): boolean {
    if (m.priority && m.priority !== ctx.priority) return false;
    if (m.services && m.services.length > 0 && !m.services.includes(ctx.service)) return false;
    if (m.service_group && !ctx.groupIds.includes(m.service_group)) return false;
    // The preview answers "who is told when this FIRES".
    if (m.status && m.status !== "firing") return false;
    if (m.env && m.env !== ctx.env) return false;
    if (m.rule_name && !ctx.ruleName.toLowerCase().includes(m.rule_name.toLowerCase())) return false;
    return true;
}

export function previewRouting(
    rule: RoutingRuleInput,
    policies: NotificationPolicy[],
    channels: NotificationChannel[],
    groups: ServiceGroup[],
): RoutingPreview {
    const { service, env } = routableDimensions(rule.query_filters);
    const ctx = {
        priority: rule.priority || "P2",
        service,
        env,
        ruleName: rule.name,
        groupIds: groupsContaining(groups, service),
    };
    const channelMap = new Map(channels.map((ch) => [ch.id, ch]));
    const ordered = [...policies].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

    const steps: RoutingStep[] = [];
    const shadowed: NotificationPolicy[] = [];
    const invalid: NotificationPolicy[] = [];
    const seen = new Set<string>();
    const destinations: NotificationChannel[] = [];
    const missingIds = new Set<string>();
    let matched = false;
    let stopped = false;

    const take = (ids: string[]) => {
        const reached: NotificationChannel[] = [];
        let missing = 0;
        for (const id of ids) {
            const ch = channelMap.get(id);
            if (!ch) {
                missing++;
                missingIds.add(id);
                continue;
            }
            reached.push(ch);
            if (!seen.has(id)) {
                seen.add(id);
                destinations.push(ch);
            }
        }
        return { reached, missing };
    };

    for (const policy of ordered) {
        if (!policy.enabled) continue;
        let matchers: PolicyMatchers;
        try {
            matchers = JSON.parse(policy.matchers);
        } catch {
            // Not reported per render: the router skips it, and the preview lists it as invalid.
            invalid.push(policy);
            continue;
        }
        if (!matchPolicy(matchers, ctx)) continue;
        if (stopped) {
            shadowed.push(policy);
            continue;
        }
        matched = true;
        let ids: string[];
        try {
            const parsed = JSON.parse(policy.channel_ids || "[]");
            ids = Array.isArray(parsed) ? parsed : [];
        } catch {
            invalid.push(policy);
            continue;
        }
        const { reached, missing } = take(ids);
        steps.push({ policy, channels: reached, missing });
        if (!policy.continue_matching) stopped = true;
    }

    const viaRuleChannels = !matched;
    if (viaRuleChannels) take(parseIdList(rule.notification_channel_ids));

    return { steps, viaRuleChannels, destinations, missing: missingIds.size, shadowed, invalid, service, env };
}

/** Channel types that reach a person promptly. Email and webhooks are not paging. */
const PAGING_TYPES = new Set(["pagerduty", "slack"]);

/**
 * True when a P0/P1 rule reaches people only through non-paging channels. The
 * seeded "High (P1) — PagerDuty + Email" policy resolved to one email address,
 * and its name invited the reading that P1 pages someone.
 */
export function urgentWithoutPaging(priority: string | undefined, preview: RoutingPreview): boolean {
    const p = priority || "P2";
    if (p !== "P0" && p !== "P1") return false;
    return preview.destinations.length > 0 && !preview.destinations.some((ch) => PAGING_TYPES.has(ch.type));
}

export function channelTypeLabel(type: string): string {
    switch (type) {
        case "pagerduty":
            return "PagerDuty";
        case "slack":
            return "Slack";
        case "email":
            return "Email";
        case "webhook":
            return "Webhook";
        default:
            return type;
    }
}

// ─── History incidents ───

export interface Incident {
    key: string;
    rule_id: string;
    rule_name: string;
    /** The firing transition; absent when the list starts mid-incident. */
    fired?: AlertHistoryEntry;
    /** The resolving transition; absent while it is still firing. */
    resolved?: AlertHistoryEntry;
    /** True when this is the rule's latest transition and it is firing. */
    ongoing: boolean;
}

/**
 * Pairs history transitions into incidents: each `firing` opens one for its
 * rule and the next `resolved` for that rule closes it. History arrives newest
 * first and capped, so the oldest row may be a `resolved` whose firing is
 * beyond the page — that incident has no start rather than a made-up one.
 */
export function groupIncidents(history: AlertHistoryEntry[]): Incident[] {
    const ascending = [...history].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const open = new Map<string, Incident>();
    const incidents: Incident[] = [];
    for (const entry of ascending) {
        if (entry.status === "firing") {
            const prev = open.get(entry.rule_id);
            // A second firing with no resolve between them (a restart, a missed
            // window) closes nothing; the earlier one stays unresolved.
            if (prev) prev.ongoing = false;
            const inc: Incident = {
                key: entry.id,
                rule_id: entry.rule_id,
                rule_name: entry.rule_name,
                fired: entry,
                ongoing: true,
            };
            open.set(entry.rule_id, inc);
            incidents.push(inc);
        } else if (entry.status === "resolved" || entry.status === "ok") {
            const inc = open.get(entry.rule_id);
            if (inc) {
                inc.resolved = entry;
                inc.ongoing = false;
                open.delete(entry.rule_id);
            } else {
                incidents.push({
                    key: entry.id,
                    rule_id: entry.rule_id,
                    rule_name: entry.rule_name,
                    resolved: entry,
                    ongoing: false,
                });
            }
        }
    }
    return incidents.sort((a, b) => incidentTime(b) - incidentTime(a));
}

function incidentTime(inc: Incident): number {
    return new Date((inc.fired ?? inc.resolved)!.created_at).getTime();
}

// ─── Events deep link ───

/**
 * The Events-page filters a rule's own `eq` filters translate to. Only
 * service/name/level: those are the params the Events page reads from a link.
 * Any other filter on the rule (data.*, env, a contains) is NOT carried, so the
 * link can show more than the rule counted — never less.
 */
function eventsFiltersOf(rule: AlertRule): EventsLink {
    const out: EventsLink = {};
    for (const f of parseFilters(rule.query_filters)) {
        if (f.operator !== "eq" || typeof f.value !== "string" || f.value === "") continue;
        if ((f.field === "service" || f.field === "name" || f.field === "level") && !out[f.field]) {
            out[f.field] = f.value;
        }
    }
    return out;
}

/**
 * The events behind an incident: the rule's filters over the window it was
 * judged on — from one evaluation window plus the hold before it fired, to
 * when it resolved (or now, while ongoing; or one window after the start when
 * no resolve is recorded). A minute of margin either side, because the
 * evaluator's ticks do not line up with the history timestamps.
 */
export function incidentEventsHref(
    rule: AlertRule,
    start: string | undefined,
    end: string | undefined,
    ongoing: boolean,
    now: number,
): string | null {
    const anchor = start ?? end;
    if (!anchor) return null;
    const interval = (rule.evaluation_interval_seconds || 300) * 1000;
    const hold = (rule.for_seconds || 0) * 1000;
    const margin = 60_000;
    const s = new Date(anchor).getTime();
    if (Number.isNaN(s)) return null;
    const e = end ? new Date(end).getTime() : ongoing ? now : s + interval;
    return eventsHref({
        ...eventsFiltersOf(rule),
        from: new Date(s - interval - hold - margin),
        to: new Date(e + margin),
    });
}
