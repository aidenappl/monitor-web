export interface Event {
  timestamp: string;
  service: string;
  name: string;
  env?: string;
  job_id?: string;
  request_id?: string;
  trace_id?: string;
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

export interface EventQueryParams {
  service?: string;
  env?: string;
  job_id?: string;
  request_id?: string;
  trace_id?: string;
  name?: string;
  level?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  [key: `data.${string}`]: string;
}
