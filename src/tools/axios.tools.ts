import { ApiResult } from "@/types/auth.types";
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import Cookies from "js-cookie";

// All auth/admin requests go through the same-origin Next.js proxy at
// /api/monitor, which forwards mon-* cookies to monitor-core and relays
// Set-Cookie back (rewriting the refresh cookie path — see the proxy route).
const axios_api = axios.create({
  baseURL: "/api/monitor",
  headers: {
    "Content-Type": "application/json",
  },
  validateStatus: () => true,
  timeout: 15000,
  withCredentials: true,
});

// Attach CSRF token on state-changing requests (double-submit cookie pattern).
axios_api.interceptors.request.use((config) => {
  const method = (config.method ?? "get").toLowerCase();
  if (method !== "get" && method !== "head" && method !== "options") {
    const csrfToken = Cookies.get("mon-csrf");
    if (csrfToken) {
      config.headers.set("X-CSRF-Token", csrfToken);
    }
  }
  return config;
});

// Refresh token deduplication — concurrent 401s share one refresh attempt.
let refreshPromise: Promise<boolean> | null = null;

const attemptRefresh = async (): Promise<boolean> => {
  try {
    const res = await axios_api.post("/auth/refresh");
    return res.status === 200 && res.data?.success;
  } catch {
    return false;
  }
};

axios_api.interceptors.response.use(async (response) => {
  if (typeof window === "undefined") return response;

  if (response.status === 401) {
    // Never try to refresh the auth endpoints themselves.
    const url = response.config.url ?? "";
    if (url.includes("/auth/login") || url.includes("/auth/refresh")) {
      return response;
    }

    if (!refreshPromise) {
      refreshPromise = attemptRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;

    if (refreshed) {
      return axios_api.request(response.config);
    }

    // Refresh failed — clear the JS-readable logged-in cookie and bounce to login.
    document.cookie = "mon-logged-in=; Max-Age=0; path=/";
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    return response;
  }

  if (response.status === 403 && response.data?.error_code === 4003) {
    window.location.href = "/unauthorized";
  }

  if (response.status === 403 && response.data?.error_code === 4004) {
    window.location.href = "/pending";
  }

  return response;
});

const fetchApi = async <T>(
  config: AxiosRequestConfig
): Promise<ApiResult<T>> => {
  try {
    const response = await axios_api.request(config);

    if (response.data && response.data.success) {
      return {
        success: true,
        status: response.status,
        message: response.data.message,
        data: response.data.data as T,
      };
    }

    return {
      success: false,
      error: response.data?.error ?? "unknown_error",
      error_message:
        response.data?.error_message ?? "An unexpected error occurred",
      error_code: response.data?.error_code ?? 0,
      status: response.status,
    };
  } catch (err: unknown) {
    const axiosError = err as AxiosError;
    return {
      success: false,
      status: axiosError.response?.status ?? 500,
      error: "request_failed",
      error_message: axiosError.message ?? "Request failed unexpectedly",
      error_code: -1,
    };
  }
};

export { fetchApi, axios_api };
