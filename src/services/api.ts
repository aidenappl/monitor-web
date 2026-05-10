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
    Issue,
} from "@/types";

// All requests go through the Next.js server-side proxy at /api/monitor.
// The proxy forwards them to MONITOR_API_URL with the MONITOR_API_KEY header
// attached server-side, so the API key is never included in the browser bundle.
const API_BASE = "/api/monitor";

async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        // Grant revoked — redirect to unauthorized page.
        if (response.status === 403) {
            try {
                const body = await response.clone().json();
                if (body?.error_code === 4003 && typeof window !== "undefined") {
                    window.location.href = "/unauthorized";
                    throw new Error("grant required");
                }
            } catch (e) {
                if (e instanceof Error && e.message === "grant required") throw e;
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
    name: string
): Promise<ApiResponse<APIKeyCreateResult>> {
    return fetchApi<ApiResponse<APIKeyCreateResult>>("/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
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
