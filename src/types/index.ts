import type { User } from "@/types/auth.types";

export interface Event {
    timestamp: string;
    service: string;
    name: string;
    env?: string;
    job_id?: string;
    request_id?: string;
    trace_id?: string;
    user_id?: string;
    level?: string;
    data?: Record<string, unknown>;
}

export interface HealthResponse {
    status: string;
    enqueued: number;
    dropped: number;
    pending: number;
}

export interface Pagination {
    count: number;
    next: string;
    previous: string;
}

export interface ApiResponse<T> {
    success: boolean;
    message: string;
    pagination?: Pagination;
    data: T;
}

// Query params now support Django-style operators: field__operator=value
// e.g., service=users, name__contains=user, data.count__gt=100
export interface EventQueryParams {
    level?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    // Allow dynamic keys for field filters with operators
    [key: string]: string | number | undefined;
}

// Analytics Types
export type AggregationType =
    | "count"
    | "count_unique"
    | "sum"
    | "avg"
    | "min"
    | "max"
    | "p50"
    | "p90"
    | "p95"
    | "p99";

export type FilterOperator =
    | "eq"
    | "neq"
    | "lt"
    | "gt"
    | "lte"
    | "gte"
    | "contains"
    | "startswith"
    | "endswith"
    | "in";

export interface AnalyticsFilter {
    field: string;
    operator: FilterOperator;
    value: string | number | string[];
}

export interface AnalyticsQueryParams {
    aggregation?: AggregationType;
    field?: string;
    group_by?: string[];
    filters?: AnalyticsFilter[];
    from?: string;
    to?: string;
    order_by?: string;
    order_desc?: boolean;
    limit?: number;
}

export interface AnalyticsDataPoint {
    value: number;
    groups?: Record<string, string>;
}

export interface AnalyticsResponse {
    data: AnalyticsDataPoint[];
    total: number;
}

export type TimeSeriesInterval = "minute" | "hour" | "day" | "week" | "month";

export interface TimeSeriesQueryParams {
    aggregation?: AggregationType;
    field?: string;
    interval: TimeSeriesInterval;
    group_by?: string[];
    filters?: AnalyticsFilter[];
    from?: string;
    to?: string;
    fill_zeros?: boolean;
}

export interface TimeSeriesDataPoint {
    timestamp: string;
    value: number;
}

export interface TimeSeriesSeries {
    name: string;
    data_points: TimeSeriesDataPoint[];
}

export interface TimeSeriesResponse {
    series: TimeSeriesSeries[];
}

export interface TopNQueryParams {
    aggregation?: AggregationType;
    field?: string;
    group_by: string;
    filters?: AnalyticsFilter[];
    from?: string;
    to?: string;
    limit?: number;
}

export interface TopNDataPoint {
    key: string;
    value: number;
}

export interface TopNResponse {
    data: TopNDataPoint[];
}

export interface GaugeQueryParams {
    aggregation?: AggregationType;
    field?: string;
    filters?: AnalyticsFilter[];
    from?: string;
    to?: string;
}

export interface GaugeResponse {
    value: number;
}

export interface CompareQueryParams {
    aggregation?: AggregationType;
    field?: string;
    filters?: AnalyticsFilter[];
    from?: string;
    to?: string;
    compare_from?: string;
    compare_to?: string;
}

export interface CompareResponse {
    current: number;
    previous: number;
    change: number;
    change_percent: number;
}

// Dashboard Widget Types
export type WidgetType = "gauge" | "timeseries" | "topn" | "compare";

export interface BaseWidgetConfig {
    id: string;
    type: WidgetType;
    title: string;
    aggregation: AggregationType;
    field?: string;
    filters: AnalyticsFilter[];
}

export interface GaugeWidgetConfig extends BaseWidgetConfig {
    type: "gauge";
    variant?: "default" | "error" | "success" | "warning";
}

export interface TimeSeriesWidgetConfig extends BaseWidgetConfig {
    type: "timeseries";
    display?: "chart" | "table";
    interval?: TimeSeriesInterval;
    group_by?: string[];
    fill_zeros?: boolean;
    color?: "blue" | "red" | "green" | "amber";
}

export interface TopNWidgetConfig extends BaseWidgetConfig {
    type: "topn";
    group_by: string;
    limit?: number;
}

export interface CompareWidgetConfig extends BaseWidgetConfig {
    type: "compare";
    invertColors?: boolean;
}

export type WidgetConfig =
    | GaugeWidgetConfig
    | TimeSeriesWidgetConfig
    | TopNWidgetConfig
    | CompareWidgetConfig;

export interface Dashboard {
    id: string;
    name: string;
    widgets: WidgetConfig[];
}

// API Keys
export type APIKeyScope = "admin" | "ingest";

export interface APIKey {
    id: string;
    name: string;
    scope: APIKeyScope;
    key_prefix: string;
    created_at: string;
    last_used_at?: string;
}

export interface APIKeyCreateResult extends APIKey {
    key: string;
}

// Dashboards
export interface SavedDashboard {
    id: string;
    name: string;
    description: string;
    config: string;
    created_at: string;
    updated_at: string;
}

// Saved Views
export interface SavedView {
    id: string;
    name: string;
    query_params: string;
    page: string;
    created_at: string;
}

// Priority levels
export type AlertPriority = "P0" | "P1" | "P2" | "P3";

export const PRIORITY_LABELS: Record<AlertPriority, string> = {
    P0: "Critical",
    P1: "High",
    P2: "Medium",
    P3: "Low",
};

export const PRIORITY_COLORS: Record<AlertPriority, string> = {
    P0: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    P1: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    P2: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    P3: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

// Alert Rules
export interface AlertRule {
    id: string;
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
    created_at: string;
    updated_at: string;
    state?: AlertState;
}

// Service Groups
export interface ServiceGroup {
    id: string;
    name: string;
    description: string;
    services: string;
    created_at: string;
    updated_at: string;
}

// Notification Policies
export interface PolicyMatchers {
    priority?: string;
    services?: string[];
    service_group?: string;
    status?: string;
    env?: string;
    rule_name?: string;
}

export interface NotificationPolicy {
    id: string;
    name: string;
    description: string;
    position: number;
    matchers: string;
    channel_ids: string;
    continue_matching: boolean;
    repeat_interval_seconds: number;
    enabled: boolean;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export interface AlertState {
    rule_id: string;
    status: "ok" | "firing" | "resolved";
    value: number;
    fired_at?: string;
    resolved_at?: string;
    last_notified_at?: string;
}

export interface AlertHistoryEntry {
    id: string;
    rule_id: string;
    rule_name: string;
    status: string;
    value: number;
    message: string;
    created_at: string;
}

// Notification Channels
export interface NotificationChannel {
    id: string;
    name: string;
    type: "webhook" | "slack" | "email" | "pagerduty";
    config: string;
    created_at: string;
}

// Alert SSE Event (from /v1/alerts/stream)
export interface AlertNotificationEvent {
    type: string;
    rule_id: string;
    rule_name: string;
    status: "firing" | "resolved";
    value: number;
    message: string;
    timestamp: string;
}

// Issues
/**
  * An issue's lifecycle state — one axis, not two.
  *
  * `unresolved` is both the default for a new issue and the backlog; there is no
  * separate "backlog" value. Automated recurrence only ever transitions OUT of
  * `resolved` (reopening it as a regression), so an issue left `in_progress` is
  * never reset by the error happening again.
  */
export type IssueStatus = "unresolved" | "in_progress" | "resolved" | "ignored";

export type IssuePriority = "low" | "medium" | "high" | "critical";

/** Who performed an action. `api_key` is how agents and CI authenticate. */
export type ActorKind = "user" | "api_key" | "system";

/**
  * One append-only fact about an issue. Comments, status changes, regressions and
  * pull-request events all arrive as entries in this single feed.
  */
export type TimelineEntryType =
    | "comment"
    | "status_changed"
    | "regressed"
    | "assigned"
    | "unassigned"
    | "priority_changed"
    | "title_changed"
    | "pr_linked"
    | "pr_unlinked"
    | "pr_merged"
    | "pr_closed"
    | "pr_reopened";

export interface IssueTimelineEntry {
    id: number;
    issue_id: string;
    type: TimelineEntryType;
    actor_kind: ActorKind;
    actor_user_id?: number;
    actor_api_key_id?: string;
    /**
      * Denormalised on write, so an entry still names who acted after that user is
      * deactivated or that API key deleted. Always render this rather than
      * resolving the id.
      */
    actor_label: string;
    body?: string;
    metadata?: Record<string, unknown>;
    dedupe_key?: string;
    created_at: string;
    edited_at?: string;
    deleted_at?: string;
}

export type IssueLinkKind = "pull_request" | "issue" | "commit";

export interface IssueLink {
    id: number;
    issue_id: string;
    provider: string;
    kind: IssueLinkKind;
    url: string;
    owner?: string;
    repo?: string;
    number?: number;
    /**
      * title/state/merged/author are a cache of GitHub's view, refreshed by
      * webhook. They are optional because a link is stored even when GitHub could
      * not be reached — the chip degrades to a bare URL rather than failing.
      */
    title?: string;
    state?: string;
    merged?: boolean;
    author?: string;
    state_synced_at?: string;
    linked_by_label: string;
    inserted_at: string;
    updated_at: string;
}

/** Which repository a reporting service is built from. */
export interface ServiceRepo {
    service: string;
    provider: string;
    owner: string;
    repo: string;
    default_branch?: string;
}

/**
  * One day of an issue's activity, from a rollup with no retention limit — so the
  * sparkline still has shape for an issue whose raw events have expired.
  */
export interface OccurrenceDay {
    day: string;
    occurrences: number;
    first_seen: string;
    last_seen: string;
}

export interface Issue {
    id: string;
    fingerprint: string;
    service: string;
    name: string;
    path?: string;
    message: string;
    status: IssueStatus;
    priority?: IssuePriority;
    title?: string;
    assignee_user_id?: number;
    occurrence_count: number;
    /** How many times this issue has been reopened by a recurrence. */
    regression_count: number;
    first_seen: string;
    last_seen: string;
    resolved_at?: string;
    regressed_at?: string;

    /** Attached by the read layer; absent on responses that do not enrich. */
    assignee?: User;
    links?: IssueLink[];
    repository?: ServiceRepo;
    comment_count?: number;
    /** Detail view only. */
    history?: OccurrenceDay[];
}

// Tenancy registry — the zone/project rows the switcher picks from and the admin
// registry page manages.
//
// ⚠️ THERE IS NO DELETE, ANYWHERE, AND THAT IS LOAD-BEARING. Retirement is
// `POST .../retire`, which moves `status` to "deleted" and keeps the row forever
// so the UNIQUE key on slug makes the name permanently spent. Events carry a
// 30-day TTL and the occurrence rollup has none, so a recycled slug would
// reattach a month of one tenant's events — and a permanent daily rollup — to a
// different tenant, with every reference still syntactically valid and nothing
// logged. If a `reqDeleteZone` ever appears below, something has gone wrong.

export type RegistryStatus = "active" | "deleted";

/**
 * What the last probe of a zone's query URL found.
 *
 * ⚠️ SEVEN VALUES, NOT A BOOLEAN, and the middle ones are the point. "Something
 * answered" and "the thing I expected answered" are different questions, and a
 * UI that collapses them renders a registry row pointed at the wrong box with a
 * green tick beside it. Mirrors monitor-core's `structs.ZoneReachability`,
 * declared worst-to-best.
 *
 *  - `unknown`      never probed. Carries no claim at all — NOT a synonym for OK.
 *  - `unconfigured` no query URL recorded, so there was nothing to probe.
 *  - `unreachable`  the probe ran and got no usable answer.
 *  - `unverified`   something answered 200 but would not say which zone it is.
 *  - `mismatched`   it answered as a DIFFERENT zone (or as a control plane).
 *  - `degraded`     the right zone, but its own /ready says it is not serving.
 *  - `healthy`      the right zone, and ready.
 */
export type ZoneReachability =
    | "unknown"
    | "unconfigured"
    | "unreachable"
    | "unverified"
    | "mismatched"
    | "degraded"
    | "healthy";

/**
 * One whole ClickHouse instance. A zone selects which backend answers.
 *
 * ⚠️ THE ROW RECORDS INFRASTRUCTURE; IT DOES NOT CREATE ANY. The stack, its
 * ClickHouse, its MariaDB, the DNS record and the certificate were all
 * provisioned by hand before the row existed, and nothing reconciles the two. A
 * row whose `query_url` points at another zone is syntactically perfect and
 * semantically catastrophic — the dashboard shows one zone's data under another
 * zone's name and nothing anywhere is in an error state. The reachability fields
 * are the only thing that can tell those apart.
 */
export interface Zone {
    id: number;
    slug: string;
    display_name: string;
    status: RegistryStatus;

    /** PUBLIC origin SDKs POST events to. Ends up copied into other repos' config. */
    ingest_url: string;
    /** CONTROL-PLANE hop monitor-core reads this zone through; the probe's target. */
    query_url: string;

    /**
     * ⚠️ `reachability` WITHOUT `last_probe_at` IS AN UNDATED CLAIM. Nothing
     * re-probes on a timer, so the value is a record of the last look and may be
     * months old. Render the two together or neither — see
     * `components/admin/ZoneHealth.tsx`.
     *
     * `reported_zone` is what the far end SAID it was, kept verbatim beside the
     * slug this registry expected. Untrusted remote text, never an identifier to
     * navigate by.
     */
    reachability: ZoneReachability;
    reachability_detail: string;
    reported_zone: string;
    last_probe_at: string | null;

    created_at: string;
    updated_at: string;
}

/**
 * A tenant inside one zone — the dimension every event is filed under.
 *
 * `slug` is unique WITHIN its zone, not globally, so a project is only ever
 * meaningful alongside the zone it was listed from.
 */
export interface Project {
    id: number;
    zone_id: number;
    slug: string;
    display_name: string;
    status: RegistryStatus;
    created_at: string;
    updated_at: string;
}

/**
 * The projects listing, plus which of them an unset `?project` resolves to.
 *
 * `default_project_slug` is a property of the INSTALL, not of any row — it is
 * monitor-core's `MON_DEFAULT_PROJECT`. The switcher needs it to avoid offering
 * the same tenant twice: once as the "nothing selected" row and once as an
 * ordinary project, two URLs for one thing.
 */
export interface ListProjectsResponse {
    projects: Project[];
    default_project_slug: string;
}

// ── Registry WRITE payloads (admin only, control plane only) ─────────────────
//
// These mirror monitor-core's `routes/HandleAdminZones.router.go` and
// `routes/HandleAdminProjects.router.go`. Note what is NOT here: no `slug` on an
// update, and no `status` anywhere. The server refuses both with a 400 rather
// than dropping them, and leaving them out of the type means a call site cannot
// build the request that gets refused.

/** `POST /admin/zones`. Both URLs are required — a zone with no address is not something there is anything to record. */
export interface CreateZonePayload {
    slug: string;
    display_name: string;
    ingest_url: string;
    query_url: string;
}

/**
 * `PUT /admin/zones/{id}`. Every field optional: absent means "leave it alone".
 *
 * ⚠️ NO `slug`. A zone slug is immutable and the server returns 400 for one,
 * which is deliberate — silently dropping it would answer 200 to "rename this
 * zone" having renamed nothing, and the operator would go on believing the new
 * name is live while events keep arriving under the old one.
 */
export interface UpdateZonePayload {
    display_name?: string;
    ingest_url?: string;
    query_url?: string;
}

/** `POST /admin/zones/{id}/projects`. The zone comes from the path — a project slug is unique only within one. */
export interface CreateProjectPayload {
    slug: string;
    display_name: string;
}

/** `PUT /admin/projects/{id}`. Display name only: slug, zone and status are all refused. */
export interface UpdateProjectPayload {
    display_name?: string;
}

/**
 * `POST /admin/zones/{id}/probe` — the verdict, plus the row it was written to.
 *
 * ⚠️ AN UNREACHABLE ZONE IS A 200 HERE. The probe succeeded; what it found was a
 * zone that is down, or worse, a zone that is somebody else. So `res.success`
 * means "we got an answer about the zone", NOT "the zone is fine" — read
 * `reachability` for that. Treating the HTTP status as the health signal is how
 * a mismatched zone ends up with a green tick.
 */
export interface ZoneProbeResult {
    zone: Zone | null;
    reachability: ZoneReachability;
    reachability_detail: string;
    reported_zone: string;
}
