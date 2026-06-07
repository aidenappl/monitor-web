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
export interface Issue {
    id: string;
    fingerprint: string;
    service: string;
    name: string;
    path?: string;
    message: string;
    status: "unresolved" | "resolved" | "ignored";
    occurrence_count: number;
    first_seen: string;
    last_seen: string;
    resolved_at?: string;
}
