import { fetchApi } from "@/tools/axios.tools";
import {
  ApiResult,
  AdminSSOProvider,
  SSOProviderPayload,
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
