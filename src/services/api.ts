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
        // Grant revoked — redirect to re-authenticate via forta login.
        if (response.status === 403) {
            try {
                const body = await response.clone().json();
                if (body?.error_code === 4003 && typeof window !== "undefined") {
                    const api = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080").replace(/\/+$/, "");
                    window.location.href = `${api}/forta/login`;
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
