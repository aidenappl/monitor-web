// Auth / identity types for Monitor's native accounts + pluggable SSO.
// These are provider-neutral — Forta is just one linkable identity provider.

export type UserRole = "admin" | "editor" | "viewer" | "pending";

export interface Identity {
  id: number;
  provider: string; // "password" | "forta" | "google" | ...
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
export interface SSOProviderConfig {
  slug: string;
  button_label: string;
  login_url: string;
}

// A provider is either an OIDC issuer (URLs discovered from issuer_url) or a
// raw OAuth2 provider with explicit endpoint URLs (this is how Forta plugs in).
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
}

// Discriminated API result used by the axios auth/admin layer. This is distinct
// from the dashboard's non-discriminated ApiResponse in types/index.ts.
export type ApiSuccess<T> = {
  success: true;
  status: number;
  message: string;
  data: T;
};

export type ApiError = {
  success: false;
  status: number;
  error: string;
  error_message: string;
  error_code: number;
};

export type ApiResult<T> = ApiSuccess<T> | ApiError;
