import { Pagination } from "@/types";

// Auth / identity types for Monitor's native accounts + pluggable SSO.
// These are provider-neutral — every IdP is just another linkable identity.

export type UserRole = "admin" | "editor" | "viewer" | "pending";

export interface Identity {
  id: number;
  provider: string; // "password" | "google" | any configured SSO slug
  provider_user_id: string;
  provider_email: string | null;
  email_verified: boolean;
  created_at?: string;
  last_login_at?: string | null;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  active: boolean;
  email_verified: boolean;
  identities?: Identity[];
  updated_at?: string;
  inserted_at?: string;
}

// Public SSO config (per enabled provider) returned by GET /auth/sso/config.
/**
 * SSOProviderConfig is one entry from the shared `GET /auth/sso/config` contract.
 *
 * ⚠️ Shared with lattice-api and openbucket-api. `slug` and `button_label` are the
 * legacy field names, retained optional so a page keeps working against an API
 * that has not deployed the new shape yet — delete them once all three have.
 */
export interface SSOProviderConfig {
  name: string;
  display_name: string;
  display_icon: string | null;
  button_color: string | null;
  button_text_color: string | null;
  login_url: string;
  sort_order: number;

  /** @deprecated legacy shape */
  slug?: string;
  /** @deprecated legacy shape */
  button_label?: string;
}

/**
 * SSOConfigResponse is the WHOLE `GET /auth/sso/config` body — an OBJECT with a
 * `providers` array, not a bare array.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS ENVELOPE IS THE CONTRACT, AND GETTING IT WRONG FAILS SILENTLY.
 *
 * It was previously typed as `SSOProviderConfig[]`, so `providers.length` read
 * `undefined` off an object, the `providers.length > 0` guard on the login page
 * went falsy, and every SSO button vanished — with no error, no empty state and
 * nothing in the console. An SSO-only user then had no way to sign in at all.
 *
 * The API deliberately returns an object rather than a bare array so it can grow
 * a sibling field later (whether native password login is enabled, for one)
 * without breaking clients. Read `.providers`; never assign the body straight to
 * a provider list.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface SSOConfigResponse {
  providers: SSOProviderConfig[];
}

// A provider is either an OIDC issuer (URLs discovered from issuer_url) or a
// raw OAuth2 provider with explicit endpoint URLs.
export type SSOProviderKind = "oidc" | "oauth2";

// Admin view of a single SSO provider row (GET /admin/sso-providers). Mirrors
// the backend adminProviderView projection — the client secret itself is never
// returned, only the has_secret flag. Nullable URL/detail fields are omitted by
// the API (omitempty) so they arrive as undefined when unset.
export interface AdminSSOProvider {
  id: number;
  slug: string;
  display_name: string;
  kind: SSOProviderKind;
  issuer_url?: string;
  authorize_url?: string;
  token_url?: string;
  userinfo_url?: string;
  jwks_url?: string;
  introspect_url?: string;
  client_id?: string;
  scopes: string;
  email_claim: string;
  email_verified_claim: string;
  trust_email_verified: boolean;
  subject_claim: string;
  button_label?: string;
  allow_auto_link: boolean;
  auto_provision: boolean;
  enabled: boolean;
  has_secret: boolean;
  // ── Branding ────────────────────────────────────────────────────────────
  display_icon?: string;
  icon_url?: string;
  button_color?: string;
  button_text_color?: string;
  sort_order?: number;

  /** Whether a fetched icon is cached and being served by the API. */
  has_icon?: boolean;
  /** Why the last icon fetch failed, if it did. A failure never blocks saving. */
  icon_error?: string;

}

// Create/update payload for a provider. client_secret is write-only (plaintext,
// encrypted at rest by the backend) — send it only when setting/rotating the
// secret, and leave it blank to keep the existing one on edit.
export interface SSOProviderPayload {
  slug?: string;
  display_name?: string;
  kind?: SSOProviderKind;
  issuer_url?: string;
  authorize_url?: string;
  token_url?: string;
  userinfo_url?: string;
  jwks_url?: string;
  introspect_url?: string;
  client_id?: string;
  client_secret?: string;
  client_secret_ref?: string;
  scopes?: string;
  email_claim?: string;
  email_verified_claim?: string;
  trust_email_verified?: boolean;
  subject_claim?: string;
  button_label?: string;
  allow_auto_link?: boolean;
  auto_provision?: boolean;
  enabled?: boolean;
  display_icon?: string;
  icon_url?: string;
  button_color?: string;
  button_text_color?: string;
  sort_order?: number;

}

// Discriminated API result used by the axios auth/admin layer. This is distinct
// from the dashboard's non-discriminated ApiResponse in types/index.ts.
export type ApiSuccess<T> = {
  success: true;
  status: number;
  message: string;
  data: T;

  /**
   * Carried through from monitor-core's responder envelope. Kept on the
   * discriminated union because list endpoints return it and at least one page
   * (the events table) reads it — dropping it during the axios migration would
   * have silently broken pagination.
   */
  pagination?: Pagination;
};

export type ApiError = {
  success: false;
  status: number;
  error: string;
  error_message: string;
  error_code: number;
};

export type ApiResult<T> = ApiSuccess<T> | ApiError;
