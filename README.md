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
and the admin pages — SSO-provider CRUD, and the tenancy registry (zones and the
projects inside them).

The registry page records infrastructure; it does not create any. A zone row is a claim
that a stack which already exists is reachable at a given address, so recording or
re-pointing one is followed by a **probe** that asks the far end which zone it is and
compares the answer with the row. Re-pointing also *discards* the previous verdict
server-side, so a row can never wear a green tick earned by an address it no longer
points at. A zone that was never verified — or that answers as a *different* zone — is
marked as such in the list and can never be mistaken for a healthy one. Nothing on that page deletes: retiring keeps the row forever so its slug stays
permanently spent.

It holds no data of its own — every screen is a view over `monitor-core`, reached through
a server-side proxy that forwards the `mon-*` session cookies and the CSRF header.

Every observability page is scoped: the **zone** is a path segment (`/{zone}/errors`)
because it selects which backend answers, and the **project** is a query param
(`?project=atlas`) because it filters inside one. Both are chosen from the navbar's
scope switcher, which hides on the zone-agnostic pages. Changing either **remounts** the
page — a `ScopeBoundary` keyed on the scope, so every page refetches without having to
name the project in a dependency array. AGENTS.md §6 has the full argument, including why
the session's project is a *selector* and not a tenancy boundary.

## Role in the Monitor ecosystem

- **`monitor-core`** — the Go API this app renders **and authenticates against** (native
  accounts, Monitor-owned JWT sessions, pluggable SSO). All calls are proxied to it.
- **`go-monitor` / `monitor-js`** — SDKs that ship the events shown here.
- **`monitor-mcp`** — MCP server exposing the same query API to Claude.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Redux
Toolkit (`authSlice` + `AuthProvider`, gated on the `mon-logged-in` cookie) ·
`@aidenappleby/keyring-js` (secrets) · Font Awesome (private kit) · **one** axios client
for every layer, auth and dashboard alike (no SWR/React Query — and no second transport;
see AGENTS.md §5). Auth is native accounts + config-driven SSO — no identity-provider SDK.

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
| `dev lint` | ESLint **+ the static guards** (`npm run lint` → `eslint && npm run guards`) |
| `npm run guards` | The static guards alone (`scripts/guards.mjs`, dependency-free Node) |
| `dev typecheck` | `tsc --noEmit` |
| `dev check` | lint + prettier check + typecheck |

## Project structure

**Routes are scoped by zone.** `src/app/[zone]/*` holds the observability pages —
Events (`/{zone}`), Errors, Performance, Live, Analytics, Dashboard, Alerts,
Notifications — plus `settings` (**API keys**, which belong to one project inside one
zone). A server-side `[zone]/layout.tsx` 404s an unknown zone and mounts the
`ScopeBoundary` every page renders inside. `src/app/page.tsx` is a redirect-only resolver
for bare `/`, and `src/app/not-found.tsx` is the 404 a retired or mistyped zone lands on.
Zone-agnostic surfaces stay at the root: `login`, `pending`, `unauthorized`, `settings`
(account-level only), `settings/security`, `admin/sso`, `admin/registry`, and the `api/`
proxy + SSE bridge routes.

`src/services/api.service.ts` — the ONE axios client (CSRF, the `?project` selector,
401-refresh, 403 routing); `src/services/api.ts` and `{auth,admin}.service.ts` — the
`req*` surfaces on top of it; `src/services/registry.server.ts` — server-only zone
lookup; `src/services/upstream.server.ts` — which `monitor-core` answers a given request.
`src/tools/routing.tools.ts` — the pure zone/project/`?next` route helpers.
`src/components/ScopeBoundary.tsx` + `src/hooks/useScope.ts` — how a page knows, and
re-reads, which tenant it is showing.
`src/store/` — Redux auth; `src/context/AuthContext.tsx` — session hydration.
`src/proxy.ts` — the `mon-logged-in` navigation gate. Full tree + conventions in
[AGENTS.md](./AGENTS.md).

## Deployment

Built into a standalone Docker image (`output: "standalone"`), pushed to
`registry.appleby.cloud/monitor-web`, run under Lattice. Deploys happen via CI on
`main` — do not deploy manually.

## Contributing & further reading

Read **[AGENTS.md](./AGENTS.md)** before working here — it documents the two HTTP layers,
the full API call inventory, the auth model (native accounts + SSO, cookies, the proxy),
the SSE architecture, and current known gaps. Related: `monitor-core` (the API + auth
backend), `go-monitor` (the SDK).
