import type { UserRole } from "@/types/auth.types";

/** The roles an admin can give. `pending` is the absence of one, not a choice. */
export const ASSIGNABLE_ROLES: UserRole[] = ["viewer", "editor", "admin"];

/**
 * One line per role, shown in option titles, the role-change confirmation and
 * the "What can each role do?" popover. Kept to what monitor-core actually
 * enforces (`middleware/role_gate.go` + `RequireAdmin`): roles gate VERBS, never
 * projects — every approved account reads every project on the install.
 */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
    pending: "No access. Sees the approval screen until an admin gives them a role.",
    viewer: "Read-only. Can browse events, errors, dashboards and analytics, but change nothing.",
    editor: "Everything a viewer can do, plus triage issues and manage alerts, dashboards, notifications and API keys.",
    admin: "Everything an editor can do, plus manage users, SSO providers and the zone registry.",
};

/** Rows of the permission matrix: which roles may do each thing. */
export const PERMISSIONS: { label: string; roles: UserRole[] }[] = [
    { label: "Read events, errors, dashboards, analytics", roles: ["viewer", "editor", "admin"] },
    { label: "Run an alert rule's test", roles: ["viewer", "editor", "admin"] },
    { label: "Triage issues (status, assign, comment)", roles: ["editor", "admin"] },
    { label: "Manage alerts, dashboards, notifications", roles: ["editor", "admin"] },
    { label: "Mint and revoke API keys", roles: ["editor", "admin"] },
    { label: "Manage users, SSO and the registry", roles: ["admin"] },
];

const RANK: Record<UserRole, number> = { pending: 0, viewer: 1, editor: 2, admin: 3 };

/** True when moving from `from` to `to` takes something away. */
export const isDemotion = (from: UserRole, to: UserRole) => RANK[to] < RANK[from];
