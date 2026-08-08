import { fetchApi } from "@/tools/axios.tools";
import {
  ApiResult,
  User,
  Identity,
  SSOConfigResponse,
} from "@/types/auth.types";

// ── Native auth ──────────────────────────────────────────────────────────

export const reqLogin = (
  email: string,
  password: string
): Promise<ApiResult<User>> =>
  fetchApi<User>({ url: "/auth/login", method: "POST", data: { email, password } });

export const reqRegister = (
  email: string,
  password: string,
  name: string
): Promise<ApiResult<User>> =>
  fetchApi<User>({
    url: "/auth/register",
    method: "POST",
    data: { email, password, name },
  });

export const reqRefresh = (): Promise<ApiResult<null>> =>
  fetchApi<null>({ url: "/auth/refresh", method: "POST" });

export const reqLogout = (): Promise<ApiResult<null>> =>
  fetchApi<null>({ url: "/auth/logout", method: "POST" });

export const reqGetSelf = (): Promise<ApiResult<User>> =>
  fetchApi<User>({ url: "/auth/self", method: "GET" });

export type UpdateSelfPayload = {
  name?: string;
  password?: string;
  current_password?: string;
};

export const reqUpdateSelf = (
  data: UpdateSelfPayload
): Promise<ApiResult<User>> =>
  fetchApi<User>({ url: "/auth/self", method: "PUT", data });

// ── SSO / linked identities ──────────────────────────────────────────────

// Returns the ENVELOPE — `{ providers: [...] }` — not a bare array. See
// SSOConfigResponse for why the difference is not cosmetic.
export const reqGetSSOConfig = (): Promise<ApiResult<SSOConfigResponse>> =>
  fetchApi<SSOConfigResponse>({ url: "/auth/sso/config", method: "GET" });

export const reqGetIdentities = (): Promise<ApiResult<Identity[]>> =>
  fetchApi<Identity[]>({ url: "/auth/self/identities", method: "GET" });

// Starts a link flow for the given provider; backend returns the authorize_url
// the SPA must navigate to so the user proves ownership of the provider account.
export const reqLinkIdentity = (
  slug: string
): Promise<ApiResult<{ authorize_url: string }>> =>
  fetchApi<{ authorize_url: string }>({
    url: `/auth/self/identities/${slug}`,
    method: "POST",
  });

export const reqUnlinkIdentity = (slug: string): Promise<ApiResult<null>> =>
  fetchApi<null>({ url: `/auth/self/identities/${slug}`, method: "DELETE" });
