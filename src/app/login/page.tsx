"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { reqLogin, reqGetSSOConfig } from "@/services/auth.service";
import { SSOProviderButtons } from "@/components/sso-provider-buttons";
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
      if (!res.success) return;
      // ⚠️ `.providers`, NOT the body itself. Assigning the envelope straight to
      // this state is what previously hid every SSO button: `providers.length`
      // read undefined off an object, the render guard went falsy, and the whole
      // section disappeared without an error anywhere. Array.isArray keeps a
      // future shape change loud instead of invisible.
      if (Array.isArray(res.data?.providers)) {
        setProviders(res.data.providers);
        return;
      }
      console.error(
        "GET /auth/sso/config returned an unexpected shape; expected { providers: [...] }.",
        res.data,
      );
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
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-background">
      <div className="w-full max-w-sm flex flex-col items-center">
        <div className="flex items-center gap-3 mb-6">
          <Image
            src="/Monitor-Logo-Dark.svg"
            alt="Monitor"
            width={40}
            height={40}
            className="w-10 h-10 shadow-md rounded-xl"
            priority
          />
          <span className="text-xl font-semibold tracking-tight dark:text-white">
            Monitor
          </span>
          <span className="h-4 w-px bg-border-strong" />
          <span className="text-sm text-muted">
            Appleby Cloud
          </span>
        </div>

        <div className="w-full bg-surface rounded-xl p-6 shadow-sm border border-border">
          <p className="text-sm text-muted text-center mb-5">
            Sign in to continue
          </p>

          <div className="flex flex-col gap-5">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field
                id="email"
                label="Email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={setEmail}
              />
              <Field
                id="password"
                label="Password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />

              {error && <ErrorAlert message={error} />}

              <button
                type="submit"
                disabled={submitting}
                className="cursor-pointer bg-accent text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>

            {providers.length > 0 && (
              <>
                <Divider />
                <SSOProviderButtons providers={providers} apiURL={API_BASE} />
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="absolute bottom-6 text-xs text-dimmed">
        © {new Date().getFullYear()} Appleby Cloud
      </footer>
    </main>
  );
}

// Sub-components

function Field({
  id,
  label,
  type,
  placeholder,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-secondary"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="border border-border-strong bg-surface-elevated text-primary placeholder:text-muted rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow"
      />
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800 rounded-lg p-3">
      <svg
        className="w-4 h-4 mt-0.5 shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-dimmed uppercase tracking-wide">
        or continue with
      </span>
      <div className="flex-1 h-px bg-border" />
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
