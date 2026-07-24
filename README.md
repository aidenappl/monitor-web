# monitor-web

The observability dashboard for the Monitor platform — event search, error triage,
performance, live tail, analytics, dashboards, alerting, plus native login and
account/SSO management.

> **Monitor platform** · Next.js app · `monitor.appleby.cloud` (Lattice)

---

## Overview

`monitor-web` is the Sentry/Datadog-style UI on top of the `monitor-core` API. It
renders events, groups errors into issues, charts analytics, streams a live event tail,
and manages alert rules, notification policies, and channels. It also hosts the
platform's authentication UI: a native email/password login with per-provider SSO
buttons, an account page for linking/unlinking sign-in methods and setting a password,
and an admin page for SSO-provider CRUD.

It holds no data of its own — every screen is a view over `monitor-core`, reached through
a server-side proxy that forwards the `mon-*` session cookies and the CSRF header.

## Role in the Monitor ecosystem

- **`monitor-core`** — the Go API this app renders **and authenticates against** (native
  accounts, Monitor-owned JWT sessions, pluggable SSO). All calls are proxied to it.
- **`go-monitor` / `monitor-js`** — SDKs that ship the events shown here.
- **`monitor-mcp`** — MCP server exposing the same query API to Claude.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Redux
Toolkit (`authSlice` + `AuthProvider`, gated on the `mon-logged-in` cookie) ·
`@aidenappleby/keyring-js` (secrets) · Font Awesome (private kit) · axios for the
auth/admin layer + native `fetch` for the dashboard data layer (no SWR/React Query).
`forta-js` has been removed — auth is native + config-driven SSO.

## Getting started

### Prerequisites

- Node 20+
- A running `monitor-core` (local default `http://localhost:8080`)
- mkcert (for local HTTPS — the `mon-*` session cookies are `Secure`)
- A FontAwesome `NPM_TOKEN` in the environment (the private `@awesome.me` kit; `npm ci`
  fails without it)

### Setup

```bash
export NPM_TOKEN="<fontawesome-token>"
npm ci
dev setup-local     # mkcert + /etc/hosts for monitor.local.appleby.cloud (one-time)
dev dev             # HTTPS dev server
```

Set `NEXT_PUBLIC_MONITOR_API_URL` to your **`monitor-core` origin** (defaults to
`http://localhost:8080`). It is read both by the server proxy (as the upstream) and by
the login page (for the full-page SSO redirect), so it must point at the API host, not at
this app. Do not create `.env` files by hand in prod — secrets are injected by Keyring at
startup.

## Development

| Command | What it does |
|---|---|
| `dev dev` | HTTPS dev server (cookies work) |
| `dev dev-http` | Plain HTTP dev server (Secure cookies won't be set) |
| `dev build` | Production build (`next build`) |
| `dev lint` | ESLint |
| `dev typecheck` | `tsc --noEmit` |
| `dev check` | lint + prettier check + typecheck |

## Project structure

`src/app/*` — one route per page (Events, Errors, Performance, Live, Analytics,
Dashboard, Alerts, Notifications, Settings) plus `login`, `settings/security`,
`admin/sso`, and the `api/` proxy + SSE bridge routes. `src/services/api.ts` — dashboard
data `req*` (native fetch); `src/services/{auth,admin}.service.ts` + `src/tools/axios.tools.ts`
— auth/admin `req*` (axios, CSRF + 401-refresh). `src/store/` — Redux auth;
`src/context/AuthContext.tsx` — session hydration. `src/proxy.ts` — the `mon-logged-in`
navigation gate. Full tree + conventions in [AGENTS.md](./AGENTS.md).

## Deployment

Built into a standalone Docker image (`output: "standalone"`), pushed to
`registry.appleby.cloud/monitor-web`, run under Lattice. Deploys happen via CI on
`main` — do not deploy manually.

## Contributing & further reading

Read **[AGENTS.md](./AGENTS.md)** before working here — it documents the two HTTP layers,
the full API call inventory, the auth model (native accounts + SSO, cookies, the proxy),
the SSE architecture, and current known gaps. Related: `monitor-core` (the API + auth
backend), `go-monitor` (the SDK).
