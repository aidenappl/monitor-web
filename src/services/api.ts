import {
    Event,
    HealthResponse,
    ApiResponse,
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
import Cookies from "js-cookie";
import { refreshSession, endSession } from "@/tools/session.tools";

// All dashboard data requests go through the Next.js server-side proxy at
// /api/monitor, which forwards the caller's mon-* session cookies to monitor-core
// and relays Set-Cookie back (so refreshed tokens reach the browser). Auth is the
// Monitor session (mon-access-token); state-changing requests must echo the
// mon-csrf cookie in the X-CSRF-Token header (double-submit CSRF).
const API_BASE = "/api/monitor";

// Never attempt a refresh for the auth endpoints themselves — refreshing in
// response to a failed refresh is an infinite loop.
function isAuthEndpoint(endpoint: string): boolean {
    return endpoint.startsWith("/auth/login") || endpoint.startsWith("/auth/refresh");
}

async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    // Attach the CSRF token on state-changing methods. Several /v1 query
    // endpoints (timeseries, analytics, topn…) are POST-with-body reads, and
    // monitor-core's CSRF middleware enforces the double-submit token on all
    // non-GET requests — without this they 403 with error_code 4031.
    const method = (options.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const csrf = Cookies.get("mon-csrf");
        if (csrf) (headers as Record<string, string>)["X-CSRF-Token"] = csrf;
    }

    let response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    // ── 401 → refresh once, then retry ───────────────────────────────────────
    //
    // ⚠️ THIS CLIENT USED TO GO STRAIGHT TO /login ON ANY 401, on the assumption
    // that "the proxy relays monitor-core's rotating refresh, so a 401 here means
    // even the refresh token is gone". That assumption was wrong. The proxy
    // FORWARDS requests and relays Set-Cookie; it does not refresh anything.
    // Refreshing is the client's job — which tools/axios.tools.ts did and this
    // one did not.
    //
    // The effect: every time the 15-minute access token expired, whichever client
    // happened to fire first decided whether you were silently refreshed or
    // dumped to the login page. Most data pages use THIS client, so the usual
    // outcome was the logout.
    //
    // refreshSession is shared with the other client on purpose. monitor-core
    // rotates refresh tokens with REUSE DETECTION, so two independent refreshes
    // racing would revoke the whole family and log the user out for good — a
    // worse bug than the one being fixed here.
    if (response.status === 401 && typeof window !== "undefined" && !isAuthEndpoint(endpoint)) {
        if (await refreshSession()) {
            response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
        }
    }

    if (!response.ok) {
        // Still 401 after a refresh attempt: the refresh token really is gone.
        if (response.status === 401 && typeof window !== "undefined") {
            endSession();
            throw new Error("session expired");
        }

        // 403: role denial (4003) → /unauthorized; pending account (4004) → /pending.
        if (response.status === 403) {
            try {
                const body = await response.clone().json();
                if (typeof window !== "undefined") {
                    if (body?.error_code === 4003) {
                        window.location.href = "/unauthorized";
                        throw new Error("grant required");
                    }
                    if (body?.error_code === 4004) {
                        window.location.href = "/pending";
                        throw new Error("account pending");
                    }
                }
            } catch (e) {
                if (e instanceof Error && (e.message === "grant required" || e.message === "account pending")) throw e;
                // JSON parse failed — fall through to generic error
            }
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

export async function getHealth(): Promise<HealthResponse> {
    return fetchApi<HealthResponse>("/health");
}

export async function getEvents(
    params: EventQueryParams = {}
): Promise<ApiResponse<Event[]>> {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
            searchParams.append(key, String(value));
        }
    });

    const query = searchParams.toString();
    const endpoint = query ? `/v1/events?${query}` : "/v1/events";

    return fetchApi<ApiResponse<Event[]>>(endpoint);
}

export async function getLabelValues(
    label: "service" | "env" | "name" | "level"
): Promise<ApiResponse<string[]>> {
    return fetchApi<ApiResponse<string[]>>(`/v1/labels/${label}/values`);
}

export async function getDataKeys(
    service?: string
): Promise<ApiResponse<string[]>> {
    const query = service ? `?service=${encodeURIComponent(service)}` : "";
    return fetchApi<ApiResponse<string[]>>(`/v1/data/keys${query}`);
}

export async function getDataValues(
    key: string,
    service?: string
): Promise<ApiResponse<string[]>> {
    const params = new URLSearchParams({ key });
    if (service) params.append("service", service);
    return fetchApi<ApiResponse<string[]>>(`/v1/data/values?${params}`);
}

// Analytics API

export async function getAnalytics(
    params: AnalyticsQueryParams
): Promise<ApiResponse<AnalyticsResponse>> {
    return fetchApi<ApiResponse<AnalyticsResponse>>("/v1/analytics", {
        method: "POST",
        body: JSON.stringify(params),
    });
}

export async function getTimeSeries(
    params: TimeSeriesQueryParams
): Promise<ApiResponse<TimeSeriesResponse>> {
    return fetchApi<ApiResponse<TimeSeriesResponse>>("/v1/timeseries", {
        method: "POST",
        body: JSON.stringify(params),
    });
}

export async function getTopN(
    params: TopNQueryParams
): Promise<ApiResponse<TopNResponse>> {
    return fetchApi<ApiResponse<TopNResponse>>("/v1/topn", {
        method: "POST",
        body: JSON.stringify(params),
    });
}

export async function getGauge(
    params: GaugeQueryParams
): Promise<ApiResponse<GaugeResponse>> {
    return fetchApi<ApiResponse<GaugeResponse>>("/v1/gauge", {
        method: "POST",
        body: JSON.stringify(params),
    });
}

export async function getCompare(
    params: CompareQueryParams
): Promise<ApiResponse<CompareResponse>> {
    return fetchApi<ApiResponse<CompareResponse>>("/v1/compare", {
        method: "POST",
        body: JSON.stringify(params),
    });
}

// API Keys

export async function reqListAPIKeys(): Promise<ApiResponse<APIKey[]>> {
    return fetchApi<ApiResponse<APIKey[]>>("/v1/api-keys");
}

export async function reqCreateAPIKey(
    name: string,
    scope: "admin" | "ingest" = "admin"
): Promise<ApiResponse<APIKeyCreateResult>> {
    return fetchApi<ApiResponse<APIKeyCreateResult>>("/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name, scope }),
    });
}

export async function reqDeleteAPIKey(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/api-keys/${id}`, {
        method: "DELETE",
    });
}

// Dashboards

export async function reqListDashboards(): Promise<ApiResponse<SavedDashboard[]>> {
    return fetchApi<ApiResponse<SavedDashboard[]>>("/v1/dashboards");
}

export async function reqCreateDashboard(
    name: string,
    description: string,
    config: string
): Promise<ApiResponse<SavedDashboard>> {
    return fetchApi<ApiResponse<SavedDashboard>>("/v1/dashboards", {
        method: "POST",
        body: JSON.stringify({ name, description, config }),
    });
}

export async function reqGetDashboard(
    id: string
): Promise<ApiResponse<SavedDashboard>> {
    return fetchApi<ApiResponse<SavedDashboard>>(`/v1/dashboards/${id}`);
}

export async function reqUpdateDashboard(
    id: string,
    name: string,
    description: string,
    config: string
): Promise<ApiResponse<SavedDashboard>> {
    return fetchApi<ApiResponse<SavedDashboard>>(`/v1/dashboards/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name, description, config }),
    });
}

export async function reqDeleteDashboard(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/dashboards/${id}`, {
        method: "DELETE",
    });
}

// Saved Views

export async function reqListViews(
    page?: string
): Promise<ApiResponse<SavedView[]>> {
    const query = page ? `?page=${encodeURIComponent(page)}` : "";
    return fetchApi<ApiResponse<SavedView[]>>(`/v1/views${query}`);
}

export async function reqCreateView(
    name: string,
    queryParams: string,
    page: string
): Promise<ApiResponse<SavedView>> {
    return fetchApi<ApiResponse<SavedView>>("/v1/views", {
        method: "POST",
        body: JSON.stringify({ name, query_params: queryParams, page }),
    });
}

export async function reqDeleteView(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/views/${id}`, {
        method: "DELETE",
    });
}

// Alert Rules

export async function reqListAlertRules(): Promise<ApiResponse<AlertRule[]>> {
    return fetchApi<ApiResponse<AlertRule[]>>("/v1/alert-rules");
}

export async function reqCreateAlertRule(
    data: Partial<AlertRule>
): Promise<ApiResponse<AlertRule>> {
    return fetchApi<ApiResponse<AlertRule>>("/v1/alert-rules", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function reqGetAlertRule(
    id: string
): Promise<ApiResponse<AlertRule>> {
    return fetchApi<ApiResponse<AlertRule>>(`/v1/alert-rules/${id}`);
}

export async function reqUpdateAlertRule(
    id: string,
    data: Partial<AlertRule>
): Promise<ApiResponse<AlertRule>> {
    return fetchApi<ApiResponse<AlertRule>>(`/v1/alert-rules/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function reqDeleteAlertRule(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/alert-rules/${id}`, {
        method: "DELETE",
    });
}

export async function reqTestAlertRule(
    id: string
): Promise<ApiResponse<{ value: number; would_fire: boolean }>> {
    return fetchApi<ApiResponse<{ value: number; would_fire: boolean }>>(
        `/v1/alert-rules/${id}/test`,
        { method: "POST" }
    );
}

// Alert History

export async function reqListAlertHistory(
    ruleId?: string,
    limit?: number
): Promise<ApiResponse<AlertHistoryEntry[]>> {
    const params = new URLSearchParams();
    if (ruleId) params.append("rule_id", ruleId);
    if (limit) params.append("limit", String(limit));
    const query = params.toString();
    const endpoint = query ? `/v1/alert-history?${query}` : "/v1/alert-history";
    return fetchApi<ApiResponse<AlertHistoryEntry[]>>(endpoint);
}

// Notification Channels

export async function reqListNotificationChannels(): Promise<ApiResponse<NotificationChannel[]>> {
    return fetchApi<ApiResponse<NotificationChannel[]>>("/v1/notification-channels");
}

export async function reqCreateNotificationChannel(
    name: string,
    type: string,
    config: string
): Promise<ApiResponse<NotificationChannel>> {
    return fetchApi<ApiResponse<NotificationChannel>>("/v1/notification-channels", {
        method: "POST",
        body: JSON.stringify({ name, type, config }),
    });
}

export async function reqDeleteNotificationChannel(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/notification-channels/${id}`, {
        method: "DELETE",
    });
}

export async function reqTestNotificationChannel(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/notification-channels/${id}/test`, {
        method: "POST",
    });
}

// Service Groups

export async function reqListServiceGroups(): Promise<ApiResponse<ServiceGroup[]>> {
    return fetchApi<ApiResponse<ServiceGroup[]>>("/v1/service-groups");
}

export async function reqCreateServiceGroup(
    data: Partial<ServiceGroup>
): Promise<ApiResponse<ServiceGroup>> {
    return fetchApi<ApiResponse<ServiceGroup>>("/v1/service-groups", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function reqUpdateServiceGroup(
    id: string,
    data: Partial<ServiceGroup>
): Promise<ApiResponse<ServiceGroup>> {
    return fetchApi<ApiResponse<ServiceGroup>>(`/v1/service-groups/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function reqDeleteServiceGroup(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/service-groups/${id}`, {
        method: "DELETE",
    });
}

// Notification Policies

export async function reqListPolicies(): Promise<ApiResponse<NotificationPolicy[]>> {
    return fetchApi<ApiResponse<NotificationPolicy[]>>("/v1/notification-policies");
}

export async function reqCreatePolicy(
    data: Partial<NotificationPolicy>
): Promise<ApiResponse<NotificationPolicy>> {
    return fetchApi<ApiResponse<NotificationPolicy>>("/v1/notification-policies", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function reqUpdatePolicy(
    id: string,
    data: Partial<NotificationPolicy>
): Promise<ApiResponse<NotificationPolicy>> {
    return fetchApi<ApiResponse<NotificationPolicy>>(`/v1/notification-policies/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function reqDeletePolicy(
    id: string
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>(`/v1/notification-policies/${id}`, {
        method: "DELETE",
    });
}

export async function reqReorderPolicies(
    ids: string[]
): Promise<ApiResponse<null>> {
    return fetchApi<ApiResponse<null>>("/v1/notification-policies/reorder", {
        method: "PUT",
        body: JSON.stringify({ ids }),
    });
}

// Issues

export async function reqListIssues(
    params?: { status?: string; service?: string; limit?: number; offset?: number }
): Promise<ApiResponse<Issue[]>> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    if (params?.service) searchParams.append("service", params.service);
    if (params?.limit) searchParams.append("limit", String(params.limit));
    if (params?.offset) searchParams.append("offset", String(params.offset));
    const query = searchParams.toString();
    const endpoint = query ? `/v1/issues?${query}` : "/v1/issues";
    return fetchApi<ApiResponse<Issue[]>>(endpoint);
}

export async function reqGetIssue(
    id: string
): Promise<ApiResponse<Issue>> {
    return fetchApi<ApiResponse<Issue>>(`/v1/issues/${id}`);
}

export async function reqUpdateIssue(
    id: string,
    status: string
): Promise<ApiResponse<Issue>> {
    return fetchApi<ApiResponse<Issue>>(`/v1/issues/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
    });
}

export async function reqGetIssueEvents(
    id: string,
    limit?: number
): Promise<ApiResponse<Event[]>> {
    const query = limit ? `?limit=${limit}` : "";
    return fetchApi<ApiResponse<Event[]>>(`/v1/issues/${id}/events${query}`);
}
