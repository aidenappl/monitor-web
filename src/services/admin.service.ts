import { fetchApi } from "@/services/api.service";
import {
  ApiResult,
  AdminSSOProvider,
  AdminUser,
  SSOProviderPayload,
  UserRole,
} from "@/types/auth.types";

// ── SSO Provider CRUD (multi-provider collection) ────────────────────────

export const reqListSSOProviders = (): Promise<ApiResult<AdminSSOProvider[]>> =>
  fetchApi<AdminSSOProvider[]>({ url: "/admin/sso-providers", method: "GET" });

export const reqCreateSSOProvider = (
  data: SSOProviderPayload
): Promise<ApiResult<AdminSSOProvider>> =>
  fetchApi<AdminSSOProvider>({
    url: "/admin/sso-providers",
    method: "POST",
    data,
  });

export const reqUpdateSSOProvider = (
  slug: string,
  data: SSOProviderPayload
): Promise<ApiResult<AdminSSOProvider>> =>
  fetchApi<AdminSSOProvider>({
    url: `/admin/sso-providers/${slug}`,
    method: "PUT",
    data,
  });

export const reqDeleteSSOProvider = (slug: string): Promise<ApiResult<null>> =>
  fetchApi<null>({ url: `/admin/sso-providers/${slug}`, method: "DELETE" });

// ── Users ────────────────────────────────────────────────────────────────

export const reqListUsers = (params: { role?: UserRole; q?: string; limit?: number; offset?: number } = {}): Promise<ApiResult<AdminUser[]>> =>
  fetchApi<AdminUser[]>({ url: "/admin/users", method: "GET", params });

/** Approve a pending account (set a role), change a role, or disable/enable. */
export const reqUpdateUser = (id: number, data: { role?: UserRole; active?: boolean }): Promise<ApiResult<AdminUser>> =>
  fetchApi<AdminUser>({ url: `/admin/users/${id}`, method: "PUT", data });
