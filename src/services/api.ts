import { Event, HealthResponse, ApiResponse, EventQueryParams } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(API_KEY && { "X-Api-Key": API_KEY }),
        ...options.headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
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
