"use client";

import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faUsers } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { useAuth } from "@/store/hooks";
import { reqListUsers, reqUpdateUser } from "@/services/admin.service";
import type { AdminUser, UserRole } from "@/types/auth.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const ROLES: UserRole[] = ["viewer", "editor", "admin"];
const FILTERS: { value: UserRole | ""; label: string }[] = [
    { value: "", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "admin", label: "Admins" },
    { value: "editor", label: "Editors" },
    { value: "viewer", label: "Viewers" },
];

const selectClass =
    "h-8 rounded-lg border border-border-strong bg-surface-elevated px-2 text-sm text-primary focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-accent/40";

/**
 * User admin. SSO auto-provisioned accounts arrive `pending`; approving one is
 * giving it a role. The API refuses changes to yourself and any change that
 * would leave no active admin, and says so — the message is shown as-is.
 */
export default function AdminUsersPage() {
    const { user, isLoading } = useAuth();
    const isAdmin = user?.role === "admin";
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [role, setRole] = useState<UserRole | "">("");
    const [q, setQ] = useState("");
    const [busy, setBusy] = useState<number | null>(null);
    // Role chosen in each pending row's "Approve as" select.
    const [approveAs, setApproveAs] = useState<Record<number, UserRole>>({});

    const load = useCallback(async () => {
        const res = await reqListUsers({ role: role || undefined, q: q.trim() || undefined, limit: 200 });
        if (res.success) {
            setUsers(res.data ?? []);
            setTotal(res.pagination?.count ?? res.data?.length ?? 0);
            setError(null);
        } else {
            setError(res.error_message || "Failed to load users");
        }
        setLoaded(true);
    }, [role, q]);

    useEffect(() => {
        if (!isAdmin) return;
        const t = setTimeout(load, 250);
        return () => clearTimeout(t);
    }, [isAdmin, load]);

    const update = async (u: AdminUser, change: { role?: UserRole; active?: boolean }) => {
        setBusy(u.id);
        setError(null);
        const res = await reqUpdateUser(u.id, change);
        if (res.success) {
            setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...res.data, providers: x.providers } : x)));
        } else {
            setError(res.error_message || "Failed to update user");
        }
        setBusy(null);
    };

    if (isLoading || (isAdmin && !loaded)) {
        return (
            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex justify-center">
                <FontAwesomeIcon icon={faSpinner} className="text-muted animate-spin text-lg" />
            </main>
        );
    }

    if (!isAdmin) {
        return (
            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="text-center py-12 border border-dashed border-border-strong rounded-xl">
                    <FontAwesomeIcon icon={faUsers} className="text-3xl text-dimmed mb-3" />
                    <p className="text-sm font-medium text-secondary">Admin only</p>
                    <p className="text-xs text-muted mt-1">You need an administrator role to manage users.</p>
                </div>
            </main>
        );
    }

    const pending = users.filter((u) => u.role === "pending").length;

    return (
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-primary">Users</h1>
                    <p className="text-sm text-muted mt-1">
                        Approve accounts created by SSO sign-in, change roles, and disable access.
                        {pending > 0 && ` ${pending} waiting for approval.`}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {FILTERS.map((f) => (
                        <Button
                            key={f.label}
                            size="sm"
                            variant={role === f.value ? "primary" : "secondary"}
                            onClick={() => setRole(f.value)}
                        >
                            {f.label}
                        </Button>
                    ))}
                    <div className="ml-auto w-full sm:w-64">
                        <Input
                            id="user-search"
                            aria-label="Search users"
                            placeholder="Search email or name…"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                </div>

                {error && <Alert variant="error">{error}</Alert>}

                <div className="overflow-x-auto rounded-xl border border-border-strong">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border-strong text-left text-xs uppercase tracking-wider text-secondary">
                            <tr>
                                <th className="px-4 py-3 font-medium">User</th>
                                <th className="px-4 py-3 font-medium">Sign-in</th>
                                <th className="px-4 py-3 font-medium">Role</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-strong">
                            {users.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-muted">
                                        No users match.
                                    </td>
                                </tr>
                            ) : (
                                users.map((u) => {
                                    const isMe = u.id === user?.id;
                                    const label = u.display_name || u.name || u.email;
                                    return (
                                        <tr key={u.id}>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-primary">
                                                    {label}
                                                    {isMe && <span className="ml-1.5 text-xs text-muted">(you)</span>}
                                                </div>
                                                {label !== u.email && <div className="text-xs text-muted">{u.email}</div>}
                                            </td>
                                            <td className="px-4 py-3 text-secondary">
                                                {u.providers.length ? u.providers.join(", ") : "—"}
                                            </td>
                                            <td className="px-4 py-3">
                                                {u.role === "pending" || isMe ? (
                                                    <Badge variant={u.role === "pending" ? "warning" : "default"}>{u.role}</Badge>
                                                ) : (
                                                    <select
                                                        aria-label={`Role for ${u.email}`}
                                                        className={selectClass}
                                                        value={u.role}
                                                        disabled={busy === u.id}
                                                        onChange={(e) => update(u, { role: e.target.value as UserRole })}
                                                    >
                                                        {ROLES.map((r) => (
                                                            <option key={r} value={r}>
                                                                {r}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant={u.active ? "success" : "error"}>
                                                    {u.active ? "active" : "disabled"}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-2">
                                                    {u.role === "pending" && (
                                                        <>
                                                            <select
                                                                aria-label={`Approve ${u.email} as`}
                                                                className={selectClass}
                                                                value={approveAs[u.id] ?? "viewer"}
                                                                onChange={(e) =>
                                                                    setApproveAs((p) => ({ ...p, [u.id]: e.target.value as UserRole }))
                                                                }
                                                            >
                                                                {ROLES.map((r) => (
                                                                    <option key={r} value={r}>
                                                                        as {r}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <Button
                                                                size="sm"
                                                                loading={busy === u.id}
                                                                aria-label={`Approve ${u.email}`}
                                                                onClick={() => update(u, { role: approveAs[u.id] ?? "viewer" })}
                                                            >
                                                                Approve
                                                            </Button>
                                                        </>
                                                    )}
                                                    {!isMe && u.role !== "pending" && (
                                                        <Button
                                                            size="sm"
                                                            variant="secondary"
                                                            disabled={busy === u.id}
                                                            aria-label={`Revoke access for ${u.email}`}
                                                            onClick={() => {
                                                                if (window.confirm(`Revoke ${u.email}'s access? They return to pending.`))
                                                                    update(u, { role: "pending" });
                                                            }}
                                                        >
                                                            Revoke
                                                        </Button>
                                                    )}
                                                    {!isMe && (
                                                        <Button
                                                            size="sm"
                                                            variant={u.active ? "destructive" : "secondary"}
                                                            disabled={busy === u.id}
                                                            aria-label={`${u.active ? "Disable" : "Enable"} ${u.email}`}
                                                            onClick={() => {
                                                                if (!u.active || window.confirm(`Disable ${u.email}? They can no longer sign in.`))
                                                                    update(u, { active: !u.active });
                                                            }}
                                                        >
                                                            {u.active ? "Disable" : "Enable"}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-muted">
                    Showing {users.length} of {total}. Role and status changes take effect at once here; a zone honours an
                    already-issued session for up to 15 minutes.
                </p>
            </div>
        </main>
    );
}
