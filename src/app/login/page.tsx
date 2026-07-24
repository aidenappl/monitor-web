"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { reqLogin, reqGetSSOConfig } from "@/services/auth.service";
import { SSOProviderConfig } from "@/types/auth.types";

// SSO login is a full-page redirect (the IdP round-trip and Set-Cookie happen on
// the API host), so it must target the backend directly, not the /api/monitor
// XHR proxy.
const API_BASE = (
  process.env.NEXT_PUBLIC_MONITOR_API_URL || ""
).replace(/\/+$/, "");

const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_denied: "The sign-in request was denied by the provider.",
  sso_account_disabled: "Your account is disabled. Contact an administrator.",
  sso_provision_failed: "No account exists and auto-provisioning is off.",
  sso_state: "Your sign-in session expired. Please try again.",
};

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<SSOProviderConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const code = params.get("error");
    if (code) setError(SSO_ERROR_MESSAGES[code] ?? "Sign-in failed. Please try again.");
  }, [params]);

  useEffect(() => {
    reqGetSSOConfig().then((res) => {
      if (res.success) setProviders(res.data);
    });
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await reqLogin(email, password);
    if (res.success) {
      // Full reload so the cookie-driven AuthProvider re-hydrates from scratch.
      window.location.href = "/";
      return;
    }
    setError(res.error_message || "Invalid email or password.");
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/Monitor-Logo-Transparent.svg"
            alt="Monitor"
            width={48}
            height={48}
            className="h-12 w-12"
            priority
          />
          <h1 className="text-xl font-semibold">Sign in to Monitor</h1>
        </div>

        {error && (
          <div className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm text-neutral-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm text-neutral-400">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {providers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <span className="h-px flex-1 bg-neutral-800" />
              or
              <span className="h-px flex-1 bg-neutral-800" />
            </div>
            {providers.map((p) => (
              <a
                key={p.slug}
                href={`${API_BASE}${p.login_url}`}
                className="block w-full rounded-md border border-neutral-800 px-4 py-2 text-center text-sm font-medium hover:bg-neutral-900"
              >
                {p.button_label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  // useSearchParams requires a Suspense boundary during static generation.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
