import { ApiResult } from "@/types/auth.types";
import { fetchApi } from "@/services/api.service";
import {
    Event,
    HealthResponse,
    EventQueryParams,
    AnalyticsQueryParams,
    AnalyticsResponse,
    TimeSeriesQueryParams,
    TimeSeriesResponse,
    TopNQueryParams,
    TopNResponse,
    GaugeQueryParams,
    GaugeResponse,
    CompareQueryParams,
    CompareResponse,
    APIKey,
    APIKeyCreateResult,
    SavedDashboard,
    SavedView,
    AlertRule,
    AlertHistoryEntry,
    NotificationChannel,
    NotificationPolicy,
    ServiceGroup,
    Issue,
} from "@/types";

// All dashboard data requests go through the Next.js server-side proxy at
// /api/monitor, which forwards the caller's mon-* session cookies to monitor-core
// and relays Set-Cookie back (so refreshed tokens reach the browser). Auth is the
// Monitor session (mon-access-token); state-changing requests must echo the
// mon-csrf cookie in the X-CSRF-Token header (double-submit CSRF).
/**
 * Monitor's query + admin surface, on the SHARED axios client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS FILE USED TO CARRY ITS OWN HTTP CLIENT, and that was the bug.
 *
 * It had a private raw-fetch implementation with its own CSRF header, its own
 * 403 routing and — fatally — its own 401 handling, which redirected straight to
 * /login without ever attempting a refresh. The separate axios client did
 * refresh. So whichever client fired first after the 15-minute access token
 * expired decided whether the user was silently renewed or logged out, and most
 * pages use this one.
 *
 * Nothing kept the two in step. Every cross-cutting concern now lives once, in
 * services/api.service.ts. Do not reintroduce a transport here.
 *
 * Every function returns ApiResult<T> — a VALUE, never a throw — matching
 * lattice-web, keyring-web, forta-web and forta-login.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export async function getHealth(): Promise<ApiResult<HealthResponse>> {
    return fetchApi<HealthResponse>({ url: "/health" });
}

export async function getEvents(
    params: EventQueryParams = {}
): Promise<ApiResult<Event[]>> {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
            searchParams.append(key, String(value));
        }
    });

    const query = searchParams.toString();
    const endpoint = query ? `/v1/events?${query}` : "/v1/events";

    return fetchApi<Event[]>({ url: endpoint });
}

export async function getLabelValues(
    label: "service" | "env" | "name" | "level"
): Promise<ApiResult<string[]>> {
    return fetchApi<string[]>({ url: `/v1/labels/${label}/values` });
}

export async function getDataKeys(
    service?: string
): Promise<ApiResult<string[]>> {
    const query = service ? `?service=${encodeURIComponent(service)}` : "";
    return fetchApi<string[]>({ url: `/v1/data/keys${query}` });
}

export async function getDataValues(
    key: string,
    service?: string
): Promise<ApiResult<string[]>> {
    const params = new URLSearchParams({ key });
    if (service) params.append("service", service);
    return fetchApi<string[]>({ url: `/v1/data/values?${params}` });
}

// Analytics API

export async function getAnalytics(
    params: AnalyticsQueryParams
): Promise<ApiResult<AnalyticsResponse>> {
    return fetchApi<AnalyticsResponse>({ url:"/v1/analytics", method: "POST", data: params });
}

export async function getTimeSeries(
    params: TimeSeriesQueryParams
): Promise<ApiResult<TimeSeriesResponse>> {
    return fetchApi<TimeSeriesResponse>({ url: "/v1/timeseries", method: "POST", data: params });
}

export async function getTopN(
    params: TopNQueryParams
): Promise<ApiResult<TopNResponse>> {
    return fetchApi<TopNResponse>({ url: "/v1/topn", method: "POST", data: params });
}

export async function getGauge(
    params: GaugeQueryParams
): Promise<ApiResult<GaugeResponse>> {
    return fetchApi<GaugeResponse>({ url: "/v1/gauge", method: "POST", data: params });
}

export async function getCompare(
    params: CompareQueryParams
): Promise<ApiResult<CompareResponse>> {
    return fetchApi<CompareResponse>({ url: "/v1/compare", method: "POST", data: params });
}

// API Keys

export async function reqListAPIKeys(): Promise<ApiResult<APIKey[]>> {
    return fetchApi<APIKey[]>({ url: "/v1/api-keys" });
}

export async function reqCreateAPIKey(
    name: string,
    scope: "admin" | "ingest" = "admin"
): Promise<ApiResult<APIKeyCreateResult>> {
    return fetchApi<APIKeyCreateResult>({ url: "/v1/api-keys", method: "POST", data: { name, scope } });
}

export async function reqDeleteAPIKey(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/api-keys/${id}`, method: "DELETE" });
}

// Dashboards

export async function reqListDashboards(): Promise<ApiResult<SavedDashboard[]>> {
    return fetchApi<SavedDashboard[]>({ url: "/v1/dashboards" });
}

export async function reqCreateDashboard(
    name: string,
    description: string,
    config: string
): Promise<ApiResult<SavedDashboard>> {
    return fetchApi<SavedDashboard>({ url: "/v1/dashboards", method: "POST", data: { name, description, config } });
}

export async function reqGetDashboard(
    id: string
): Promise<ApiResult<SavedDashboard>> {
    return fetchApi<SavedDashboard>({ url: `/v1/dashboards/${id}` });
}

export async function reqUpdateDashboard(
    id: string,
    name: string,
    description: string,
    config: string
): Promise<ApiResult<SavedDashboard>> {
    return fetchApi<SavedDashboard>({ url: `/v1/dashboards/${id}`, method: "PUT", data: { name, description, config } });
}

export async function reqDeleteDashboard(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/dashboards/${id}`, method: "DELETE" });
}

// Saved Views

export async function reqListViews(
    page?: string
): Promise<ApiResult<SavedView[]>> {
    const query = page ? `?page=${encodeURIComponent(page)}` : "";
    return fetchApi<SavedView[]>({ url: `/v1/views${query}` });
}

export async function reqCreateView(
    name: string,
    queryParams: string,
    page: string
): Promise<ApiResult<SavedView>> {
    return fetchApi<SavedView>({ url: "/v1/views", method: "POST", data: { name, query_params: queryParams, page } });
}

export async function reqDeleteView(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/views/${id}`, method: "DELETE" });
}

// Alert Rules

export async function reqListAlertRules(): Promise<ApiResult<AlertRule[]>> {
    return fetchApi<AlertRule[]>({ url: "/v1/alert-rules" });
}

export async function reqCreateAlertRule(
    data: Partial<AlertRule>
): Promise<ApiResult<AlertRule>> {
    return fetchApi<AlertRule>({ url:"/v1/alert-rules", method: "POST", data: data });
}

export async function reqGetAlertRule(
    id: string
): Promise<ApiResult<AlertRule>> {
    return fetchApi<AlertRule>({ url: `/v1/alert-rules/${id}` });
}

export async function reqUpdateAlertRule(
    id: string,
    data: Partial<AlertRule>
): Promise<ApiResult<AlertRule>> {
    return fetchApi<AlertRule>({ url: `/v1/alert-rules/${id}`, method: "PUT", data: data });
}

export async function reqDeleteAlertRule(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/alert-rules/${id}`, method: "DELETE" });
}

export async function reqTestAlertRule(
    id: string
): Promise<ApiResult<{ value: number; would_fire: boolean }>> {
    return fetchApi<{ value: number; would_fire: boolean }>({ url: `/v1/alert-rules/${id}/test`, method: "POST" });
}

// Alert History

export async function reqListAlertHistory(
    ruleId?: string,
    limit?: number
): Promise<ApiResult<AlertHistoryEntry[]>> {
    const params = new URLSearchParams();
    if (ruleId) params.append("rule_id", ruleId);
    if (limit) params.append("limit", String(limit));
    const query = params.toString();
    const endpoint = query ? `/v1/alert-history?${query}` : "/v1/alert-history";
    return fetchApi<AlertHistoryEntry[]>({ url: endpoint });
}

// Notification Channels

export async function reqListNotificationChannels(): Promise<ApiResult<NotificationChannel[]>> {
    return fetchApi<NotificationChannel[]>({ url: "/v1/notification-channels" });
}

export async function reqCreateNotificationChannel(
    name: string,
    type: string,
    config: string
): Promise<ApiResult<NotificationChannel>> {
    return fetchApi<NotificationChannel>({ url: "/v1/notification-channels", method: "POST", data: { name, type, config } });
}

export async function reqDeleteNotificationChannel(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/notification-channels/${id}`, method: "DELETE" });
}

export async function reqTestNotificationChannel(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/notification-channels/${id}/test`, method: "POST" });
}

// Service Groups

export async function reqListServiceGroups(): Promise<ApiResult<ServiceGroup[]>> {
    return fetchApi<ServiceGroup[]>({ url: "/v1/service-groups" });
}

export async function reqCreateServiceGroup(
    data: Partial<ServiceGroup>
): Promise<ApiResult<ServiceGroup>> {
    return fetchApi<ServiceGroup>({ url:"/v1/service-groups", method: "POST", data: data });
}

export async function reqUpdateServiceGroup(
    id: string,
    data: Partial<ServiceGroup>
): Promise<ApiResult<ServiceGroup>> {
    return fetchApi<ServiceGroup>({ url: `/v1/service-groups/${id}`, method: "PUT", data: data });
}

export async function reqDeleteServiceGroup(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/service-groups/${id}`, method: "DELETE" });
}

// Notification Policies

export async function reqListPolicies(): Promise<ApiResult<NotificationPolicy[]>> {
    return fetchApi<NotificationPolicy[]>({ url: "/v1/notification-policies" });
}

export async function reqCreatePolicy(
    data: Partial<NotificationPolicy>
): Promise<ApiResult<NotificationPolicy>> {
    return fetchApi<NotificationPolicy>({ url:"/v1/notification-policies", method: "POST", data: data });
}

export async function reqUpdatePolicy(
    id: string,
    data: Partial<NotificationPolicy>
): Promise<ApiResult<NotificationPolicy>> {
    return fetchApi<NotificationPolicy>({ url: `/v1/notification-policies/${id}`, method: "PUT", data: data });
}

export async function reqDeletePolicy(
    id: string
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: `/v1/notification-policies/${id}`, method: "DELETE" });
}

export async function reqReorderPolicies(
    ids: string[]
): Promise<ApiResult<null>> {
    return fetchApi<null>({ url: "/v1/notification-policies/reorder", method: "PUT", data: { ids } });
}

// Issues

export async function reqListIssues(
    params?: { status?: string; service?: string; limit?: number; offset?: number }
): Promise<ApiResult<Issue[]>> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    if (params?.service) searchParams.append("service", params.service);
    if (params?.limit) searchParams.append("limit", String(params.limit));
    if (params?.offset) searchParams.append("offset", String(params.offset));
    const query = searchParams.toString();
    const endpoint = query ? `/v1/issues?${query}` : "/v1/issues";
    return fetchApi<Issue[]>({ url: endpoint });
}

export async function reqGetIssue(
    id: string
): Promise<ApiResult<Issue>> {
    return fetchApi<Issue>({ url: `/v1/issues/${id}` });
}

export async function reqUpdateIssue(
    id: string,
    status: string
): Promise<ApiResult<Issue>> {
    return fetchApi<Issue>({ url: `/v1/issues/${id}`, method: "PUT", data: { status } });
}

export async function reqGetIssueEvents(
    id: string,
    limit?: number
): Promise<ApiResult<Event[]>> {
    const query = limit ? `?limit=${limit}` : "";
    return fetchApi<Event[]>({ url: `/v1/issues/${id}/events${query}` });
}
