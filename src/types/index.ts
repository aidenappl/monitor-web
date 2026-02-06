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
