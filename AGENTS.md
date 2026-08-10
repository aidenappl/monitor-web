# AGENTS.md — monitor-web

> The comprehensive working document for this repo. An agent that reads only this
> file should be able to work in monitor-web correctly. Keep it current — see
> **Keeping this file updated** at the bottom.

---

## 1. What this repo is

`monitor-web` is the **observability dashboard** for the Monitor platform
(`monitor.appleby.cloud`) — the Sentry/Datadog-style UI. It is a Next.js app that
renders event search, error/issue triage, performance, live tail, analytics,
dashboards, alerting, and notifications on top of the `monitor-core` API, and hosts the
platform's **native login + account/SSO management** UI.

It **owns**: all UI, the server-side proxy that attaches auth to `monitor-core` calls,
and the SSE bridge routes for live streaming. It **does not** own any data, business
logic, storage, or the auth backend — identity lives in `monitor-core` (accounts,
sessions, SSO); this app is a cookie-driven client of it.

---

## 2. Stack & dependencies

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** (`strict`).
- **Tailwind CSS v4** (`@tailwindcss/postcss`). Dark/light theming via `ThemeProvider`
  (theme persisted in the `mon-appearance` cookie).
- **Auth (client):** local **Redux Toolkit** — `store/slices/authSlice` (`user`,
  `isLoggedIn`, `isLoading`) + a `context/AuthContext` `AuthProvider` that hydrates it.
  There is **no identity-provider SDK**. State is gated on the JS-readable `mon-logged-in`
  cookie; the real session JWT is validated server-side by `monitor-core`.
- **HTTP:** **ONE layer** — `axios` via `src/services/api.service.ts`, returning `ApiResult<T>`.
  There were two until 2026-08-09; see the warning box in §3. Do not add a second.
- **Secrets:** `@aidenappleby/keyring-js` — injects env at server startup via
  `src/instrumentation.ts`.
- **Icons:** Font Awesome **private kit** (`@awesome.me/kit-c2d31bb269`,
  `@fortawesome/react-fontawesome`). ⚠️ `npm ci` needs a valid FontAwesome token — see §4.
- **Cookies (client reads):** `js-cookie`. **Toasts:** `react-hot-toast`.
- Path alias `@/*` → `./src/*`.

---

## 3. Project structure

```
src/
  app/
    layout.tsx              # Root layout: ThemeProvider → StoreProvider → AuthProvider → Navbar
    page.tsx                # Events (home) — table + chart + filters + saved views
    errors/page.tsx         # Issues list, status tabs, bulk resolve/ignore, detail drawer
    performance/page.tsx    # Endpoint latency (p50/p95/p99) from parallel analytics calls
    live/page.tsx           # Live event tail via SSE
    analytics/page.tsx      # Gauges, compare, time series, top-N, CSV/JSON export
    dashboard/page.tsx      # Dashboard CRUD, widget editor, template variables
    alerts/page.tsx         # Alert-rule CRUD, enable/test, history, policy preview
    notifications/page.tsx  # Policies (drag-order), service groups, channels, desktop notifs
    settings/page.tsx       # API Keys tab + MCP/AI integration tab
    settings/security/page.tsx  # Account & Security: link/unlink SSO identities + set/change password
    admin/sso/page.tsx      # Admin-only SSO provider CRUD (multi-provider)
    login/page.tsx          # Native email/password form + per-provider SSO buttons
    unauthorized/page.tsx   # 403 landing
    api/
      monitor/[...path]/route.ts  # Main proxy → ${UPSTREAM}/* (forwards cookies + X-CSRF-Token, relays Set-Cookie)
      monitor-stream/route.ts     # SSE bridge → ${UPSTREAM}/v1/events/stream
      alert-stream/route.ts       # SSE bridge → ${UPSTREAM}/v1/alerts/stream
      health/route.ts             # GET /api/health → {status:"ok"}
  services/
    api.service.ts          # THE HTTP client: axios fetchApi<T>(config) → ApiResult<T> (CSRF, 401-refresh, 403 routing) + dataOf/firstError
    api.ts                  # Query + admin surface, built on api.service.ts. No transport of its own.
    auth.service.ts         # req* for /auth/* (login, register, refresh, logout, self, identities, sso/config)
    admin.service.ts        # req* for /admin/sso-providers CRUD
  tools/
    session.tools.ts        # refreshSession() — the ONE refresh single-flight — and endSession()
  store/
    index.ts hooks.ts StoreProvider.tsx slices/authSlice.ts   # Redux (useAuth, useAppSelector/Dispatch)
  context/AuthContext.tsx   # AuthProvider — hydrates authSlice from mon-logged-in + reqGetSelf; logout()
  types/
    index.ts                # ApiResponse<T> + dashboard domain types
    auth.types.ts           # User, Identity, SSOProviderConfig, AdminSSOProvider, SSOProviderPayload, ApiResult<T>
  components/               # Navbar (user menu), ThemeProvider, and analytics/dashboard/settings groups
    ui/                     # Shared primitives ported from lattice-web — button, input, alert,
                            # badge, modal, switch. See "The shared design-token layer" below.
  lib/utils.ts              # cn() — dependency-free class joiner
  hooks/useDesktopNotifications.ts   # Desktop notification bridge over alert-stream SSE
  proxy.ts                  # Next.js proxy — gates page navigation on the mon-logged-in cookie
  instrumentation.ts        # Keyring env injection at server boot
```

### The shared design-token layer and `components/ui/`

`globals.css` carries a token layer **ported from lattice-web** so the SSO surfaces across
monitor-web, lattice-web and openbucket-web are one design language rather than three. Surface,
border, text, semantic-accent and radius families are defined as CSS custom properties and bridged
into Tailwind utilities through `@theme inline` — `bg-surface`, `text-secondary`,
`border-border-strong`, `text-healthy` and so on.

**⚠️ THE POLARITY IS THE OPPOSITE OF LATTICE-WEB'S, DELIBERATELY.** lattice-web is dark-first: it
defines dark values in `:root` and light in `:root:not(.dark)`. This app is light-first and every
existing page is written as `bg-white dark:bg-zinc-900`. So the same token NAMES carry light values
in `:root` and dark values in `.dark`. Components written against the tokens are portable between
the apps unchanged — which is the point — while pages written against zinc utilities are untouched.
**Do not "fix" this to match lattice.** Flipping it inverts the entire dashboard.

`src/components/ui/` holds the ported primitives: `button`, `input`, `alert`, `badge`, `modal`,
`switch`. `src/lib/utils.ts` has a dependency-free `cn()` — deliberately not clsx + tailwind-merge,
because the primitives put `className` last in every `cn(...)` call, so a caller's utility already
wins without a merge step.

Two things differ from lattice's originals on purpose:

- `Button`'s `primary` variant is the accent fill, not `bg-white text-black`. White-on-white is
  invisible in a light-first app.
- `Input` generates an `id` when none is passed (lattice's renders `htmlFor={undefined}`, a label
  bound to nothing) and wires `aria-invalid` + `aria-describedby` for its error.

**Scope is bounded on purpose.** The token layer and primitives exist app-wide; only the **SSO
admin and login surfaces** are converted to them. Other pages keep working on their current classes
and get converted opportunistically. A full restyle of the dashboard is separate work, not
something to smuggle into an auth change.

Navigation (`components/Navbar.tsx`): primary = Events, Errors, Performance, Live,
Analytics; secondary = Dashboard, Alerts, Notifications, Settings. The user menu shows
the user's role, links `/settings/security` (Account & Security) and — for
`role==="admin"` — `/admin/sso` (SSO Providers), and calls `logout()`.

> The `/pending` route (for freshly SSO-provisioned accounts awaiting approval, 403
> `error_code 4004`) lives at `src/app/pending/page.tsx` and offers a sign-out action.

---

## 4. Running, building & testing

Uses the `dev` CLI (`Devfile.yaml`). Prerequisites: Node 20+, `npm ci`, and (for
cookie-based auth locally) mkcert HTTPS on `*.local.appleby.cloud`.

```bash
dev dev           # HTTPS dev server (node server.js / npm run dev:ssl) — needed for cookies
dev dev-http      # plain HTTP dev (Secure cookies won't be set)
dev build         # next build
dev lint          # eslint
dev typecheck     # tsc --noEmit
dev check         # lint + prettier check + typecheck
```

> ⚠️ **`npm ci` before building.** `node_modules/` is not committed and `next build`/`tsc`
> fail with a misleading "couldn't find next/package.json" error when deps are absent. A
> stale `.next/` may exist from a prior build; don't trust it as verification.
>
> ⚠️ **FontAwesome private kit.** `.npmrc` points `@awesome.me`/`@fortawesome` at
> `npm.fontawesome.com` with `_authToken=${NPM_TOKEN}`. `npm ci` **fails without a valid
> `NPM_TOKEN`** in the environment. In CI this comes from Keyring/secrets; locally you
> must export it before installing.

Local dev must be HTTPS (`dev dev`) so the `mon-*` cookies (Secure) are set/sent. The app
proxies to a running `monitor-core` at `NEXT_PUBLIC_MONITOR_API_URL` (default
`http://localhost:8080`).

---

## 5. How code is written here

There is **ONE HTTP layer**: `src/services/api.service.ts`.

`fetchApi<T>(config: AxiosRequestConfig): Promise<ApiResult<T>>` — axios, `baseURL:
"/api/monitor"`, `withCredentials`, `validateStatus: () => true`. It:

- attaches `X-CSRF-Token` (from the JS-readable `mon-csrf` cookie) on every unsafe method —
  the double-submit half the server checks. Several `/v1` query endpoints are POST-with-body
  **reads**, so this is not optional;
- on `401`, runs `refreshSession()` — the **shared** single-flight in `tools/session.tools.ts` —
  and retries once; on failure calls `endSession()`;
- on `403` redirects by `error_code`: `4003` → `/unauthorized`, `4004` → `/pending`.

Consumers: `services/api.ts` (query + admin surface), `services/auth.service.ts`,
`services/admin.service.ts`. Add endpoints to the relevant service file, never a new transport.

⚠️ **`refreshSession` must stay a module-level singleton.** monitor-core rotates refresh tokens
with **reuse detection** — presenting a spent token revokes the whole family — and a page load
fires many requests at once. Two concurrent refreshes log the user out permanently. A singleton
per client is not a singleton, which is exactly how the two-client era failed.

⚠️ **Nothing throws on a non-2xx**, so a `catch` around an API call is dead for HTTP errors.
Check `success` explicitly wherever a failure must be visible. Helpers: `dataOf(res)` for reads
with an empty fallback, `firstError(...)` for `Promise.all` batches.

Other conventions:

- **Data fetching is imperative** — `useEffect` + `useState` + `req*` (or Redux dispatch).
  No data library. **No SWR/React Query.**
- **UI is hand-built** — no component library. Tailwind + local components.
- **Auth state comes from `useAuth()`** (`store/hooks.ts`) for `{user, isLoggedIn,
  isLoading}` and `useAuthContext()` for `logout()`. `AuthProvider` hydrates the slice
  by checking `mon-logged-in` then calling `reqGetSelf()`; a `pending` user is parked.
- **Response shapes differ by layer.** Dashboard (`monitor-core` `/v1/*`) failures carry
  `message`, not `error`. The auth/admin envelope is the full discriminated `ApiResult`
  with `error`/`error_message`/`error_code`. Don't cross the wires.

---

## 6. Domain & architecture

### Auth model (native accounts + SSO, cookie-driven)

`monitor-core` owns identity; this app drives it over cookies. There is **no
identity-provider SDK and no provider-specific component** — every IdP configured in
`sso_providers` renders as one more SSO button, driven entirely by `/auth/sso/config`.

> ### ⚠️ ONE HTTP client — `services/api.service.ts`. Do not add a second.
>
> `fetchApi<T>(config): Promise<ApiResult<T>>`, matching lattice-web / keyring-web / forta-web /
> forta-login. `validateStatus: () => true`, so **a non-2xx is a value, never a throw**.
>
> The app used to have two — an axios client for auth/admin and a raw-fetch one for the
> observability pages — so CSRF, 403 routing and 401 refresh were each written twice. Two agreed;
> the third had diverged. The fetch client redirected to `/login` on any 401 *without attempting a
> refresh*, so whichever client fired first after the 15-minute access token expired decided
> whether the user was renewed or logged out. Most pages used that one, which is why it presented
> as "randomly logged out".
>
> ⚠️ **Because nothing throws on a non-2xx, a `catch` around an API call is DEAD for HTTP errors.**
> Any page that relied on `catch` to show an error state must check `success` explicitly, or a
> failing API renders as an empty page — indistinguishable from "nothing to show". Restoring those
> was the bulk of the migration, not the type changes.
>
> Helpers: `dataOf(res)` narrows to the payload for reads with an empty fallback; `firstError(...)`
> returns the first failure in a `Promise.all` batch, reproducing the old all-or-nothing behaviour.
> Rendering partial results instead is a product decision, not a refactor.
>
> ⚠️ **`/health` is not enveloped** — it returns a bare object with no `success` field. The client
> falls back to HTTP status when `success` is absent; removing that makes health checks read as
> permanently failing.

> ### ⚠️ `/auth/sso/config` returns an ENVELOPE, not a bare array
>
> ```json
> { "providers": [ { "name": "forta", "display_name": "Continue with Forta", … } ] }
> ```
>
> Read `res.data.providers`. **Never assign `res.data` straight to a provider list** — that
> shipped, and it locked SSO-only users out of Monitor on 2026-08-07. `providers.length` read
> `undefined` off an object, the `providers.length > 0` render guard went falsy, and every SSO
> button disappeared from the login page with no error, no empty state and nothing in the
> console. The page looked fine; it just had no way in.
>
> Both consumers (`login/page.tsx`, `settings/security/page.tsx`) now check `Array.isArray`
> and log when the shape is wrong, so the next contract change is loud rather than invisible.
>
> `monitor-core` serves **only** this shape. `lattice-api` and `openbucket-api` still emit the
> legacy `enabled` / `button_label` / `login_url` fields alongside it — which is exactly why
> those two logins kept working while Monitor's broke. Do not rely on those legacy fields.

- **Cookies (set by `monitor-core`, relayed through the proxy):** `mon-access-token`
  (HttpOnly, 15m JWT), `mon-refresh-token` (HttpOnly, `Path=/auth/refresh`, 7d),
  `mon-logged-in` (JS-readable, the client's login gate), `mon-csrf` (JS-readable,
  double-submit token). The browser JS only ever reads `mon-logged-in` and `mon-csrf`.
- **Login (`login/page.tsx`):** a native email/password form (`reqLogin` →
  `POST /auth/login`, then a full reload so `AuthProvider` re-hydrates) plus one button
  per provider from `reqGetSSOConfig` (`GET /auth/sso/config`). **SSO is a full-page
  redirect** to `${NEXT_PUBLIC_MONITOR_API_URL}${login_url}` (i.e. straight to
  `monitor-core`, **not** the `/api/monitor` XHR proxy), because the IdP round-trip and
  `Set-Cookie` happen on the API host.
  The page uses the **shared Appleby Cloud login layout** — the same structure as
  `forta-login`, `openbucket-web` and `lattice-web`: full-screen centred `<main>`, a brand
  row (40px logo tile + product name + hairline + "Appleby Cloud"), a bordered card holding
  "Sign in to continue" → labelled fields → primary button → `or continue with` divider →
  SSO buttons, and a `© <year> Appleby Cloud` footer. Colours come from the app's own
  palette (zinc + blue focus ring); **the structure and spacing must not diverge** — change
  it in all four repos or not at all. `Navbar` already returns `null` on `/login`.
- **Account & Security (`settings/security/page.tsx`):** lists linked identities
  (`reqGetIdentities`), connects a provider via `reqLinkIdentity` (returns an
  `authorize_url` the page navigates to; the callback returns to `/settings/security`),
  disconnects via `reqUnlinkIdentity` (the backend refuses the last identity → `409`), and
  sets/changes the password via `reqUpdateSelf`.
- **Admin SSO (`admin/sso/page.tsx`):** full CRUD over `/admin/sso-providers` via
  `admin.service.ts`. Client secrets are write-only (never returned — the API sends only
  `has_secret`).
- **Page gating:** `proxy.ts` allows `/login`, `/unauthorized`, `/pending`, `/api/`,
  `/_next/`, `/favicon`, `/Monitor-Logo` and redirects everything else to `/login` when
  `mon-logged-in` is absent. It only gates navigation — the JWT is validated server-side.
  **Any `/public` asset referenced by a logged-out page must be allowlisted here.** The
  matcher excludes `_next/static` and `_next/image` but *not* root-level files, and
  `next/image` serves SVGs unoptimized from their raw path — so an unlisted logo 302s to
  `/login`, returns HTML, and renders as a broken image on exactly the pages that show it.

### Request flow (dashboard + auth/admin)

```
page → req*() → /api/monitor/<path>  (same origin, mon-* cookies + X-CSRF-Token)
  → app/api/monitor/[...path]/route.ts (server): fetch ${UPSTREAM}/<path>,
       forward Cookie + X-CSRF-Token, relay Set-Cookie back
       (rewrites the refresh cookie Path=/auth/refresh → /api/monitor/auth/refresh so the
        browser actually sends it back on the proxied refresh call)
  → monitor-core  (/v1/*, /auth/*, /admin/*)
```

`UPSTREAM = NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080"` (the real
`monitor-core` origin). The browser never sees the upstream URL or any API key.

### SSE (live tail + desktop alerts)

```
live/page.tsx           → EventSource(/api/monitor-stream) → app/api/monitor-stream → ${UPSTREAM}/v1/events/stream
useDesktopNotifications → EventSource(/api/alert-stream)   → app/api/alert-stream   → ${UPSTREAM}/v1/alerts/stream
```

Both bridges forward the caller's full cookie header and relay upstream `Set-Cookie`, so
long-open streams refresh. Consumers read unnamed `data: <json>\n\n` frames via
`es.onmessage`.

---

## 7. Ecosystem & related repos

| Repo | Relationship |
|---|---|
| `monitor-core` | The API this UI renders **and** authenticates against. Dashboard `req*` map to `/v1/*`; auth/admin `req*` map to `/auth/*` and `/admin/sso-providers`. Its auth model (cookies, JWT, SSO, roles) is documented in `monitor-core/AGENTS.md` §6 — keep the two in sync. |
| `go-monitor` / `monitor-js` | SDKs that produce the events this UI displays. Not called directly. |
| `monitor-mcp` | MCP server over the same API — an alternate client (dashboard/query surface only). |

---

## 8. Full API call inventory (for backend diffing)

**Dashboard data** (`services/api.ts` → `/api/monitor/*` → `${UPSTREAM}/*`):

- **Events/labels/data:** `GET /health`; `GET /v1/events` (level/from/to/limit/offset +
  Django `field__op`); `GET /v1/labels/{service|env|name|level}/values`;
  `GET /v1/data/keys?service=`; `GET /v1/data/values?key=&service=`
- **Analytics (POST):** `/v1/analytics`, `/v1/timeseries`, `/v1/topn`, `/v1/gauge`, `/v1/compare`
- **API keys:** `GET/POST /v1/api-keys`, `DELETE /v1/api-keys/{id}`
- **Dashboards:** `GET/POST /v1/dashboards`, `GET/PUT/DELETE /v1/dashboards/{id}`
- **Saved views:** `GET /v1/views?page=`, `POST /v1/views`, `DELETE /v1/views/{id}`
- **Alert rules:** `GET/POST /v1/alert-rules`, `GET/PUT/DELETE /v1/alert-rules/{id}`, `POST /v1/alert-rules/{id}/test`
- **Alert history:** `GET /v1/alert-history?rule_id=&limit=`
- **Notification channels:** `GET/POST /v1/notification-channels`, `DELETE …/{id}`, `POST …/{id}/test`
- **Service groups:** `GET/POST /v1/service-groups`, `PUT/DELETE …/{id}`
- **Notification policies:** `GET/POST /v1/notification-policies`, `PUT/DELETE …/{id}`, `PUT …/reorder`
- **Issues:** `GET /v1/issues?status=&service=&limit=&offset=`, `GET /v1/issues/{id}`, `PUT /v1/issues/{id}`, `GET /v1/issues/{id}/events?limit=`
- **Streams (bypass [...path] proxy):** SSE `GET /v1/events/stream`, `GET /v1/alerts/stream`

**Auth** (`services/auth.service.ts` → axios `/api/monitor/*`):

- `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/self`, `PUT /auth/self`
- `GET /auth/self/identities`, `POST /auth/self/identities/{slug}`, `DELETE /auth/self/identities/{slug}`
- `GET /auth/sso/config`
- **Direct-to-backend (full-page redirect, NOT proxied):** `GET /auth/sso/{slug}/login`

**Admin** (`services/admin.service.ts` → axios `/api/monitor/*`):

- `GET/POST /admin/sso-providers`, `PUT/DELETE /admin/sso-providers/{slug}`

---

## 9. Rules & guardrails + known gaps

**Rules**
- Dashboard endpoints go in `services/api.ts`; auth/admin endpoints in
  `auth.service.ts`/`admin.service.ts` over the axios layer. Keep components imperative.
- Don't introduce SWR/React Query or a component library (house standard). Axios is used
  **only** for the auth/admin layer; the dashboard layer stays on native `fetch`.
- Same-origin only for XHR — never call `monitor-core` directly from the browser except
  the deliberate full-page **SSO login redirect** (which must hit the API host so its
  `Set-Cookie` lands).
- Don't touch `Dockerfile`/`.github/workflows/` unless asked. Don't create/edit `.env`.
- Any change to the auth surface (cookies, endpoints, roles) must stay in lockstep with
  `monitor-core/AGENTS.md` §6 and be reflected in §6/§8 here.

**Resolved integration notes** (kept for context; all fixed in the auth-overhaul change)
- **`/pending` page** — now exists at `src/app/pending/page.tsx` (403 `error_code 4004` target).
- **`NEXT_PUBLIC_MONITOR_API_URL`** must be the real `monitor-core` origin (the server proxy
  `UPSTREAM` and the login page's SSO full-page-redirect base both read it). `.env.example`
  now documents this correctly and defaults to `http://localhost:8080`.
- **`current_password`** — `reqUpdateSelf` sends it on a password change and `monitor-core`'s
  `HandleUpdateSelf` now verifies it against the existing hash before updating (first-time
  password set on an SSO account does not require it).
- **403 routing** — `monitor-core` now emits `error_code` `4003` (role denial → `/unauthorized`)
  and `4004` (pending → `/pending`) via `responder.ErrorWithCode`, matching the axios/native
  interceptors.

---

## 10. Verification

```bash
# NPM_TOKEN must be in the environment — .npmrc references it as ${NPM_TOKEN} to
# fetch the private FA kit (CI provides the same from Keyring). Load it from .env:
set -a && . ./.env && set +a
npm ci
npx next build         # must succeed (fix TS errors)
npx tsc --noEmit
npm run lint
```

CI (`.github/workflows/ci.yml`) gates PRs; `build-and-deploy.yml` deploys on `main` —
it builds the image to `registry.appleby.cloud/monitor-web` and then **triggers the
redeploy itself** via `POST LATTICE_DEPLOY_URL?container=monitor-web&commit=<sha>`, the
same step every other service uses. Keep it identical, with one exception: the build step
also passes `secrets:` because this Dockerfile mounts `NPM_TOKEN` and `MONITOR_API_KEY`
via `--mount=type=secret`. Dropping that line to "match" the others breaks the build.
Two prerequisites live outside this repo: the `LATTICE_DEPLOY_URL` repo secret, and an
active deploy token on the Lattice stack — `monitor-web` and `monitor-core` share one
stack ("Trailblaze Monitor"), so one token and one URL cover both. A green run with no
visible change means checking that token's `last_used_at`. Never deploy by hand from
here. If your change altered structure, commands, the §8 API call set, or the auth model,
update this `AGENTS.md` and `README.md` in the same change.

---

## 11. Keeping this file updated

Any change to structure, stack, commands, the §8 API call inventory, or the auth model
MUST update this file in the same change. Stale docs mislead every future agent, which is
worse than no docs.
