"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { reqLogin, reqGetSSOConfig } from "@/services/auth.service";
import { SSOProviderButtons, ssoHref } from "@/components/sso-provider-buttons";
import Spinner from "@/components/Spinner";
import { SSOProviderConfig } from "@/types/auth.types";
import { NEXT_PARAM, safeNextPath } from "@/tools/routing.tools";
import { reportWarn } from "@/services/monitor.service";
import { silentSSOAllowed, startSilentSSO } from "@/tools/sso.tools";

// SSO login is a full-page redirect (the IdP round-trip and Set-Cookie happen on
// the API host), so it must target the backend directly, not the /api/monitor
// XHR proxy.
const API_BASE = (
  process.env.NEXT_PUBLIC_MONITOR_API_URL || ""
).replace(/\/+$/, "");

// The ?error= codes monitor-core's SSO callback redirects with.
// login_required is absent on purpose: it is the provider's "not signed in"
// answer to a silent attempt, the expected reason to be here.
const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_denied: "The sign-in request was denied by the provider.",
  sso_account_disabled: "Your account is disabled. Contact an administrator.",
  sso_provision_failed: "No account exists and auto-provisioning is off.",
  sso_state_invalid: "Your sign-in took too long or was started elsewhere. Please try again.",
  sso_missing_params: "Your sign-in took too long or was started elsewhere. Please try again.",
  sso_provider_unavailable: "The identity provider is unavailable. Try again shortly.",
  sso_exchange_failed: "The identity provider could not complete sign-in. Please try again.",
  sso_resolve_failed: "No account could be matched to this sign-in. Contact an administrator.",
  sso_session_failed: "Sign-in could not be completed. Please try again.",
};

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<SSOProviderConfig[]>([]);
  // Seeded from ?error= rather than set by an effect. An SSO failure arrives by
  // FULL-PAGE REDIRECT from the provider callback, so the component always
  // mounts fresh with the param already present — the effect this replaces could
  // only ever have fired on that same mount. A lazy initializer expresses that
  // without a synchronous setState inside an effect (react-hooks/set-state-in-effect),
  // which is a cascading render and, here, a redundant one.
  const [error, setError] = useState<string | null>(() => {
    const code = params.get("error");
    if (!code || code === "login_required") return null;
    return SSO_ERROR_MESSAGES[code] ?? "Sign-in failed. Please try again.";
  });
  const [submitting, setSubmitting] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  // Decided once, at mount: arriving with ?error= (a sign-in just failed, or
  // the provider said login_required) or ?signed_out=1 means no silent attempt,
  // and neither does one made in the last minute (loop guard).
  const [skipSilent] = useState(
    () => params.has("error") || params.has("signed_out") || !silentSSOAllowed(),
  );
  const next = safeNextPath(params.get(NEXT_PARAM));

  useEffect(() => {
    reqGetSSOConfig().then((res) => {
      setProvidersLoaded(true);
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
      // A contract break monitor-core cannot see — it answered 200. Key NAMES
      // only, never the body.
      reportWarn("sso_config.load.failed", {
        expected: "{ providers: [...] }",
        got_type: Array.isArray(res.data) ? "array" : typeof res.data,
        got_keys:
          res.data && typeof res.data === "object"
            ? Object.keys(res.data).slice(0, 10).join(",")
            : undefined,
        outcome: "login page renders no SSO buttons",
      });
    });
  }, []);

  // Silent SSO: with exactly one provider and nothing telling us not to, try a
  // prompt=none sign-in before showing the form. A user still signed in at the
  // identity provider comes straight back signed in; otherwise the provider
  // answers login_required and this page renders the form.
  const silentHref =
    !skipSilent && providers.length === 1 ? ssoHref(API_BASE, providers[0].login_url) : null;
  useEffect(() => {
    if (silentHref) startSilentSSO(silentHref, next);
  }, [silentHref, next]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await reqLogin(email, password);
    if (res.success) {
      // Honour the deep link the session check round-tripped through `next`, so
      // a pasted link into a specific issue survives being bounced through
      // login. safeNextPath is the open-redirect guard: `next` is an
      // attacker-supplied query parameter, so only a single-slash same-origin
      // path is ever followed. Anything else falls back to `/`, which resolves
      // to the user's zone.
      //
      // Full reload rather than a router push, so the cookie-driven AuthProvider
      // re-hydrates from scratch.
      window.location.href = safeNextPath(params.get(NEXT_PARAM)) ?? "/";
      return;
    }
    setError(res.error_message || "Invalid email or password.");
    setSubmitting(false);
  };

  if (!providersLoaded || silentHref) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Spinner />
      </main>
    );
  }

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
                <SSOProviderButtons providers={providers} apiURL={API_BASE} next={next} />
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
