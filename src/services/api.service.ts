// ⚠️ ApiResult, NOT ApiResponse. `ApiResponse` is already taken in types/index.ts
// by monitor-core's WIRE ENVELOPE ({success, message, pagination?, data}) — a
// different, legitimate concept. The rest of the ecosystem calls this union
// ApiResponse, but adopting that name here would put two different shapes behind
// one identifier, which is worse than a name that differs across repos.
import { ApiResult, ApiSuccess } from "@/types/auth.types";
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import Cookies from "js-cookie";
import { refreshSession, endSession } from "@/tools/session.tools";

/**
 * THE ONE HTTP CLIENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DO NOT ADD A SECOND ONE. This app had two — an axios client for auth/admin
 * and a raw-fetch client for the observability pages — and every cross-cutting
 * concern had to be written twice: the CSRF header, the 403 role routing, and
 * the 401 refresh. Two of the three happened to agree. The third did not: the
 * fetch client redirected to /login on any 401 without ever attempting a
 * refresh, so whichever client fired first after the 15-minute access token
 * expired decided whether the user was silently renewed or logged out.
 *
 * Nothing kept them in step; they matched only because someone wrote the same
 * logic twice and had not drifted yet. One transport is what makes that class of
 * bug impossible rather than merely absent.
 *
 * Shape matches lattice-web, keyring-web, forta-web and forta-login:
 * `validateStatus: () => true` so a non-2xx is a VALUE rather than a throw, and
 * every call returns the ApiResult<T> union.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Same-origin Next.js proxy. It forwards mon-* cookies to monitor-core and
// relays Set-Cookie back, rewriting the refresh cookie's Path=/auth/refresh so
// the browser will actually send it — see src/app/api/monitor/[...path]/route.ts.
// Calling monitor-core directly would skip that rewrite.
const BASE_API_URL = "/api/monitor";

const axiosApi = axios.create({
    baseURL: BASE_API_URL,
    headers: {
        "Content-Type": "application/json",
    },
    validateStatus: () => true,
    withCredentials: true,
    timeout: 15000,
});

// Double-submit CSRF. monitor-core enforces the token on every non-GET, and
// several /v1 query endpoints (timeseries, analytics, topn…) are POST-with-body
// READS — without this they 403 with error_code 4031.
axiosApi.interceptors.request.use((config) => {
    const method = (config.method ?? "get").toLowerCase();
    if (method !== "get" && method !== "head" && method !== "options") {
        const csrf = Cookies.get("mon-csrf");
        if (csrf) config.headers.set("X-CSRF-Token", csrf);
    }
    return config;
});

/** Auth endpoints must never trigger a refresh — refreshing in response to a
 *  failed refresh is an infinite loop. */
const isAuthEndpoint = (url: string): boolean =>
    url.includes("/auth/login") || url.includes("/auth/refresh");

/**
 * ⚠️ NOT EVERY MONITOR ENDPOINT IS ENVELOPED, and assuming otherwise fails
 * silently in the worst direction.
 *
 * Most of monitor-core answers with the responder envelope
 * ({success, message, data, pagination?}). `/health` does NOT — it returns a
 * bare object: {"dropped":0,"enqueued":13262,"pending":0,"status":"ok"}.
 *
 * A check of `payload.success === true` therefore reads `undefined` on a
 * perfectly healthy /health response and classifies it as a FAILURE. Migrating
 * getHealth onto this client without handling that would have made the health
 * page permanently red against a healthy service.
 *
 * So: if the body carries a boolean `success`, trust it. Otherwise fall back to
 * the HTTP status and hand the whole body back as `data`. A non-2xx still fails,
 * so this tolerates unenveloped endpoints without masking real errors.
 */
const toApiResult = <T>(status: number, body: unknown): ApiResult<T> => {
    const payload = (body ?? {}) as Record<string, unknown>;
    const isEnveloped = typeof payload.success === "boolean";
    const ok = isEnveloped ? payload.success === true : status >= 200 && status < 300;

    if (ok) {
        return {
            success: true,
            status,
            message: (payload.message as string) ?? "OK",
            data: (isEnveloped ? payload.data : body) as T,
            pagination: payload.pagination as ApiSuccess<T>["pagination"],
        };
    }
    return {
        success: false,
        status,
        error: (payload.error as string) ?? "request_failed",
        error_message: (payload.error_message as string) ?? (payload.message as string) ?? "Request failed",
        error_code: (payload.error_code as number) ?? status,
    };
};

const executeRequest = async <T>(config: AxiosRequestConfig): Promise<ApiResult<T>> => {
    const response = await axiosApi.request(config);
    return toApiResult<T>(response.status, response.data);
};

export const fetchApi = async <T>(config: AxiosRequestConfig): Promise<ApiResult<T>> => {
    try {
        let response = await executeRequest<T>(config);

        // 401 → refresh once, then retry. refreshSession is a SHARED singleton:
        // monitor-core rotates refresh tokens with reuse detection, so two
        // concurrent refreshes would revoke the whole family and log the user out
        // permanently — worse than the expiry being fixed here.
        if (
            response.status === 401 &&
            typeof window !== "undefined" &&
            !isAuthEndpoint(config.url ?? "")
        ) {
            if (await refreshSession()) {
                response = await executeRequest<T>(config);
            } else {
                endSession();
                return response;
            }
        }

        // 403 role routing. 4003 = no grant, 4004 = account pending approval.
        if (response.status === 403 && !response.success && typeof window !== "undefined") {
            if (response.error_code === 4003) window.location.href = "/unauthorized";
            if (response.error_code === 4004) window.location.href = "/pending";
        }

        return response;
    } catch (err: unknown) {
        // Reached only on a transport failure (DNS, timeout, offline), because
        // validateStatus never throws on a status code.
        const status = err instanceof AxiosError ? (err.response?.status ?? 0) : 0;
        return {
            success: false,
            status,
            error: "network_error",
            error_message:
                err instanceof AxiosError ? err.message : "Request failed unexpectedly",
            error_code: status || 0,
        };
    }
};
