"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck, faMagnifyingGlass, faUsers } from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "@/store/hooks";
import { reqListUsers, reqUpdateUser } from "@/services/admin.service";
import type { AdminUser, UserRole } from "@/types/auth.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { ButtonSpinner } from "@/components/ui/spinner";
import { BulkActionBar } from "@/components/BulkActionBar";
import { FailureNote, FailureState } from "@/components/FailureState";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { urlEnum, urlString, useUrlState } from "@/hooks/useUrlState";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { cn } from "@/lib/utils";
import { ASSIGNABLE_ROLES as ROLES, ROLE_DESCRIPTIONS, isDemotion } from "@/components/admin/users/roles";
import { RoleHelp } from "@/components/admin/users/RoleHelp";

type Filter = UserRole | "all";
const FILTER_VALUES: Filter[] = ["all", "pending", "admin", "editor", "viewer"];
const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "admin", label: "Admins" },
    { value: "editor", label: "Editors" },
    { value: "viewer", label: "Viewers" },
];

/** What an empty list means under each filter — "nothing pending" is good news, not a dead end. */
const EMPTY_COPY: Record<Filter, string> = {
    all: "No users yet.",
    pending: "No accounts awaiting approval.",
    admin: "No admins.",
    editor: "No editors.",
    viewer: "No viewers.",
};

// text-base below sm so iOS Safari does not zoom on focus; h-9 keeps the tap target.
const selectClass =
    "h-9 sm:h-8 rounded-lg border border-border-strong bg-surface-elevated px-2 text-base sm:text-sm text-primary focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-40";

type Change = { role?: UserRole; active?: boolean };

const nameOf = (u: AdminUser) => u.display_name || u.name || u.email;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A 32px hit area around the 16px checkbox; clicks on the padding reach the input. */
function HitArea({ children }: { children: ReactNode }) {
    return <label className="-m-2 inline-flex h-8 w-8 cursor-pointer items-center justify-center">{children}</label>;
}

export default function AdminUsersPage() {
    // useSearchParams (through useUrlState) needs a Suspense boundary on a
    // zone-agnostic page; [zone]/layout.tsx is not above this one.
    return (
        <Suspense fallback={<UsersFallback />}>
            <AdminUsers />
        </Suspense>
    );
}

/**
 * The Suspense fallback: the page's real heading over placeholder filters and
 * rows, so the swap to `AdminUsers` (which renders the same header during its
 * own first load) moves nothing.
 */
function UsersFallback() {
    return (
        <div>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-primary">Users</h1>
                    <p className="text-sm text-muted mt-1">
                        Approve accounts created by SSO sign-in, change roles, and block sign-in.
                    </p>
                    <div className="mt-1 h-6" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {[48, 72, 64, 64, 64].map((w, i) => (
                        <Skeleton key={i} className="h-9 sm:h-7 rounded-lg" style={{ width: w }} />
                    ))}
                    <Skeleton className="ml-auto h-9 w-full rounded-lg sm:w-64" />
                </div>
                <UsersListSkeleton />
            </div>
        </div>
    );
}

// Placeholder rows sized to the real ones: a table row at lg is ~61px (a
// two-line name block or an h-8 select, plus py-3); a card below lg stacks the
// name, the role/status line and the action buttons (~148px).
const SKELETON_ROWS = 5;

/** Card placeholders for below lg; the table's are a `SkeletonTable` in its tbody. */
function UserCardsSkeleton() {
    return (
        <ul className="divide-y divide-border-strong" role="status" aria-label="Loading users">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <li key={i} className="flex gap-3 px-4 py-3">
                    <div className="w-8 shrink-0 pt-0.5">
                        <Skeleton className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="space-y-1.5 py-0.5">
                            <Skeleton className="h-3.5" style={{ width: `${[52, 40, 60, 46, 56][i]}%` }} />
                            <Skeleton className="h-3 bg-zinc-100 dark:bg-zinc-800/60" style={{ width: `${[38, 30, 44, 34, 40][i]}%` }} />
                        </div>
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-9 w-28 rounded-lg" />
                            <Skeleton className="h-5 w-14 rounded-full" />
                        </div>
                        <div className="flex gap-2">
                            <Skeleton className="h-9 w-24 rounded-lg" />
                            <Skeleton className="h-9 w-28 rounded-lg" />
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    );
}

/** Both layouts' placeholders, in the same bordered boxes the list renders in. */
function UsersListSkeleton() {
    return (
        <>
            <div className="hidden lg:block rounded-xl border border-border-strong">
                {/* Stands in for the thead: one line of uppercase labels around a 16px checkbox, py-3. */}
                <div className="h-10 border-b border-border-strong" />
                <SkeletonTable rows={SKELETON_ROWS} columns={5} rowClass="h-[61px]" label="Loading users" />
            </div>
            <div className="lg:hidden rounded-xl border border-border-strong">
                <UserCardsSkeleton />
            </div>
        </>
    );
}

/**
 * User admin. SSO auto-provisioned accounts arrive `pending`; approving one is
 * giving it a role. The API refuses changes to yourself and any change that
 * would leave no active admin, and says so — the message is shown as-is.
 *
 * Every change confirms (a role select used to PUT on `onChange`, so a stray
 * arrow key could demote an admin) and reports in a toast with Undo, because
 * the row may be far from any banner.
 */
function AdminUsers() {
    const { user, isLoading } = useAuth();
    const isAdmin = user?.role === "admin";
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [loaded, setLoaded] = useState(false);
    // A failed READ. Kept apart from row actions: with no rows it replaces the
    // list (DOWN is not EMPTY); with rows it marks them as possibly stale.
    const [listError, setListError] = useState<string | null>(null);
    // The `${role}|${q}` the rows on screen were fetched for. Differs from the
    // current filters while a search is debouncing or in flight.
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [counts, setCounts] = useState<Record<UserRole, number> | null>(null);
    const [filter, setFilter] = useUrlState("role", urlEnum(FILTER_VALUES), { default: "all" });
    const [q, setQ] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
    const [busy, setBusy] = useState<number | null>(null);
    const [flash, setFlash] = useState<number | null>(null);
    // Role chosen in each pending row's "Approve as" select.
    const [approveAs, setApproveAs] = useState<Record<number, UserRole>>({});
    const confirm = useConfirm();
    const [bulkBusy, setBulkBusy] = useState(false);
    const generation = useRef(0);
    // The `${role}|${q}` the rows in `users` belong to.
    const rowsKey = useRef<string | null>(null);
    const role = filter === "all" ? undefined : filter;
    const query = q.trim();
    const key = `${filter}|${query}`;

    // You cannot change yourself (the API refuses), so you cannot select yourself.
    const selectableIds = useMemo(
        () => users.filter((u) => u.id !== user?.id).map((u) => String(u.id)),
        [users, user?.id],
    );
    const selection = useSelection(selectableIds);
    const selectedUsers = users.filter((u) => selection.isSelected(String(u.id)));

    const load = useCallback(async () => {
        const gen = ++generation.current;
        const res = await reqListUsers({ role, q: query || undefined, limit: 200 });
        // A slower response for older filters must not overwrite a newer one.
        if (gen !== generation.current) return;
        const requested = `${role ?? "all"}|${query}`;
        if (res.success) {
            setUsers(res.data ?? []);
            setTotal(res.pagination?.count ?? res.data?.length ?? 0);
            setListError(null);
            rowsKey.current = requested;
        } else {
            setListError(res.error_message || "The request failed.");
            // Rows fetched for OTHER filters would sit under this filter's chip
            // as if they matched it. Drop them, so the failure panel shows.
            if (rowsKey.current !== requested) {
                setUsers([]);
                setTotal(0);
            }
        }
        setLoadedKey(requested);
        setLoaded(true);
    }, [role, query]);

    /**
     * Per-role counts for the filter chips — one unfiltered read. The API has
     * no counts endpoint; when the install outgrows one page the counts would
     * be partial, so they are hidden rather than shown wrong.
     */
    const loadCounts = useCallback(async () => {
        const res = await reqListUsers({ limit: 200 });
        if (!res.success || (res.pagination?.count ?? 0) > (res.data?.length ?? 0)) {
            setCounts(null);
            return;
        }
        const next: Record<UserRole, number> = { pending: 0, viewer: 0, editor: 0, admin: 0 };
        for (const u of res.data ?? []) next[u.role] += 1;
        setCounts(next);
    }, []);

    // The search text the last scheduled load was for. Only a change to IT is
    // debounced: typing settles before a read goes out, but the first load on
    // mount and a filter-chip click go at once. (This used to wait 250 ms on
    // every load, including the first, which delayed every page paint.)
    const lastQuery = useRef<string | null>(null);
    useEffect(() => {
        if (!isAdmin) return;
        const typing = lastQuery.current !== null && lastQuery.current !== query;
        lastQuery.current = query;
        const t = setTimeout(load, typing ? 250 : 0);
        return () => clearTimeout(t);
    }, [isAdmin, load, query]);

    useEffect(() => {
        if (!isAdmin) return;
        const t = setTimeout(loadCounts, 0);
        return () => clearTimeout(t);
    }, [isAdmin, loadCounts]);

    const refresh = () => {
        void load();
        void loadCounts();
    };

    /**
     * One row's change. Success and failure both toast — the row may be far
     * below any banner — and success offers Undo, which is the same request
     * with the row's previous values.
     */
    const update = async (u: AdminUser, change: Change, done: string, isUndo = false) => {
        setBusy(u.id);
        const res = await reqUpdateUser(u.id, change);
        setBusy(null);
        if (!res.success) {
            toast.error(`Could not update ${u.email}: ${res.error_message || "the request failed."}`);
            return;
        }
        setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...res.data, providers: x.providers } : x)));
        setFlash(u.id);
        setTimeout(() => setFlash((f) => (f === u.id ? null : f)), 1500);
        void loadCounts();
        const previous: Change = {};
        if (change.role !== undefined) previous.role = u.role;
        if (change.active !== undefined) previous.active = u.active;
        toast.success(
            (t) => (
                <span className="flex items-center gap-3">
                    <span>{done}</span>
                    {!isUndo && (
                        <button
                            type="button"
                            className="rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-surface-elevated"
                            onClick={() => {
                                toast.dismiss(t.id);
                                const now = { ...u, ...res.data, providers: u.providers };
                                void update(now, previous, `Undone: ${u.email} is back as it was`, true);
                            }}
                        >
                            Undo
                        </button>
                    )}
                </span>
            ),
            { duration: 8000 },
        );
    };

    const changeRole = async (u: AdminUser, to: UserRole) => {
        if (to === u.role) return;
        const demotesAdmin = u.role === "admin";
        const ok = await confirm({
            title: `Change ${nameOf(u)} from ${u.role} to ${to}?`,
            description: (
                <span className="space-y-2 block">
                    <span className="block">
                        <strong className="capitalize">{to}:</strong> {ROLE_DESCRIPTIONS[to]}
                    </span>
                    {demotesAdmin && (
                        <span className="block text-destructive">
                            They lose user, SSO and registry management immediately.
                        </span>
                    )}
                    <span className="block text-muted">
                        A zone honours an already-issued session for up to 15 minutes.
                    </span>
                </span>
            ),
            confirmLabel: `Make ${to}`,
            destructive: isDemotion(u.role, to),
        });
        if (ok) await update(u, { role: to }, `${u.email} is now ${to}`);
    };

    const approve = async (u: AdminUser) => {
        const as = approveAs[u.id] ?? "viewer";
        // Granting admin is the one approval worth a second look.
        if (as === "admin") {
            const ok = await confirm({
                title: `Approve ${nameOf(u)} as admin?`,
                description: ROLE_DESCRIPTIONS.admin,
                confirmLabel: "Approve as admin",
            });
            if (!ok) return;
        }
        await update(u, { role: as }, `Approved ${u.email} as ${as}`);
    };

    const removeRole = async (u: AdminUser) => {
        const ok = await confirm({
            title: `Remove ${nameOf(u)}'s ${u.role} role?`,
            description: (
                <span className="space-y-2 block">
                    <span className="block">
                        They keep their account but go back to pending, and see the approval screen until an admin
                        approves them again. To stop them signing in at all, use <strong>Block sign-in</strong>{" "}
                        instead.
                    </span>
                    {u.role === "admin" && (
                        <span className="block text-destructive">
                            They are an admin: they lose user, SSO and registry management immediately.
                        </span>
                    )}
                </span>
            ),
            confirmLabel: "Remove role",
            destructive: true,
        });
        if (ok) await update(u, { role: "pending" }, `Removed ${u.email}'s role — now pending`);
    };

    const toggleActive = async (u: AdminUser) => {
        if (u.active) {
            const ok = await confirm({
                title: `Block ${nameOf(u)} from signing in?`,
                description: (
                    <span className="space-y-2 block">
                        <span className="block">
                            They can no longer sign in. Their role ({u.role}) is kept for when you allow sign-in again.
                            A zone honours an already-issued session for up to 15 minutes. To keep the account but
                            take away access, use <strong>Remove role</strong> instead.
                        </span>
                        {u.role === "admin" && (
                            <span className="block text-destructive">They are an admin.</span>
                        )}
                    </span>
                ),
                confirmLabel: "Block sign-in",
                destructive: true,
            });
            if (!ok) return;
        }
        await update(u, { active: !u.active }, u.active ? `Blocked ${u.email} from signing in` : `${u.email} can sign in again`);
    };

    /**
     * One request per user. Each is checked server-side on its own — including
     * the last-active-admin rule — so a batch can partly succeed, and the toast
     * says which way it went with the first refusal's own message.
     */
    const bulkUpdate = async (targets: AdminUser[], change: Change, verb: string) => {
        if (targets.length === 0) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (u) => reqUpdateUser(u.id, change));
        setBulkBusy(false);
        toastBulkResult(result, verb, "user");
        selection.clear();
        refresh();
    };

    const selectedPending = selectedUsers.filter((u) => u.role === "pending");
    const setRoleTargets = (to: UserRole) => selectedUsers.filter((u) => u.role !== "pending" && u.role !== to);
    const toEnable = selectedUsers.filter((u) => !u.active);
    const toDisable = selectedUsers.filter((u) => u.active);

    const bulkApprove = async (as: UserRole) => {
        const ok = await confirm({
            title: `Approve ${plural(selectedPending.length, "account")} as ${as}?`,
            description: `${selectedPending.map((u) => u.email).join(", ")}. ${ROLE_DESCRIPTIONS[as]}`,
            confirmLabel: `Approve as ${as}`,
        });
        if (ok) await bulkUpdate(selectedPending, { role: as }, `Approved as ${as}`);
    };

    const bulkSetRole = async (to: UserRole) => {
        const targets = setRoleTargets(to);
        if (targets.length === 0) return;
        const demoted = targets.filter((u) => isDemotion(u.role, to));
        const ok = await confirm({
            title: `Make ${plural(targets.length, "user")} ${to}?`,
            description: (
                <span className="space-y-2 block">
                    <span className="block">{targets.map((u) => u.email).join(", ")}</span>
                    <span className="block">{ROLE_DESCRIPTIONS[to]}</span>
                    {targets.some((u) => u.role === "admin") && (
                        <span className="block text-destructive">
                            Includes admins: they lose user, SSO and registry management immediately.
                        </span>
                    )}
                    {selectedPending.length > 0 && (
                        <span className="block text-muted">
                            {plural(selectedPending.length, "pending account")} skipped — approve them instead.
                        </span>
                    )}
                </span>
            ),
            confirmLabel: `Set role to ${to}`,
            destructive: demoted.length > 0,
        });
        if (ok) await bulkUpdate(targets, { role: to }, `Set ${to} on`);
    };

    const bulkSetActive = async (active: boolean) => {
        const targets = active ? toEnable : toDisable;
        if (targets.length === 0) return;
        const ok = await confirm(
            active
                ? {
                      title: `Allow ${plural(targets.length, "user")} to sign in again?`,
                      description: `${targets.map((u) => u.email).join(", ")} keep the role they had.`,
                      confirmLabel: `Allow ${targets.length}`,
                  }
                : {
                      title: `Block ${plural(targets.length, "user")} from signing in?`,
                      description: `${targets.map((u) => u.email).join(", ")} can no longer sign in; their roles are kept. A zone honours an already-issued session for up to 15 minutes.`,
                      confirmLabel: `Block ${targets.length}`,
                      destructive: true,
                  },
        );
        if (ok) await bulkUpdate(targets, { active }, active ? "Allowed sign-in for" : "Blocked");
    };

    // While auth or the first read is in flight the page renders its real
    // header, filters and search, with skeleton rows in place of the list —
    // a full-page spinner used to hide all of it and then the table popped in.
    const firstLoad = isLoading || !loaded;

    if (!isLoading && !isAdmin) {
        return (
            <div className="py-12">
                <div className="text-center py-12 border border-dashed border-border-strong rounded-xl">
                    <FontAwesomeIcon icon={faUsers} className="text-3xl text-dimmed mb-3" />
                    <p className="text-sm font-medium text-secondary">Admin only</p>
                    <p className="text-xs text-muted mt-1">You need an administrator role to manage users.</p>
                </div>
            </div>
        );
    }

    const pendingCount = counts?.pending ?? users.filter((u) => u.role === "pending").length;
    // Only a re-query of rows already on screen is "stale"; the first load has
    // its skeleton and must not also spin the search box.
    const stale = !firstLoad && loadedKey !== key;
    const allCount = counts ? counts.pending + counts.viewer + counts.editor + counts.admin : null;

    // ── Per-row pieces, shared by the table (lg+) and the cards (below lg) ──

    const roleCell = (u: AdminUser, isMe: boolean) =>
        u.role === "pending" || isMe ? (
            <Badge variant={u.role === "pending" ? "warning" : "default"} className="capitalize">
                <span title={ROLE_DESCRIPTIONS[u.role]}>{u.role}</span>
            </Badge>
        ) : (
            // Controlled by the row: a cancelled confirm leaves u.role untouched,
            // so the select snaps back on its own.
            <select
                aria-label={`Role for ${u.email}`}
                className={cn(selectClass, "w-full max-w-[9rem]")}
                value={u.role}
                disabled={busy === u.id}
                onChange={(e) => void changeRole(u, e.target.value as UserRole)}
            >
                {ROLES.map((r) => (
                    <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                        {r}
                    </option>
                ))}
            </select>
        );

    const statusCell = (u: AdminUser) => (
        <Badge variant={u.active ? "success" : "error"}>{u.active ? "Active" : "Sign-in blocked"}</Badge>
    );

    const actions = (u: AdminUser, isMe: boolean) => (
        <>
            {u.role === "pending" && (
                <>
                    <select
                        aria-label={`Approve ${u.email} as`}
                        className={selectClass}
                        value={approveAs[u.id] ?? "viewer"}
                        disabled={busy === u.id}
                        onChange={(e) => setApproveAs((p) => ({ ...p, [u.id]: e.target.value as UserRole }))}
                    >
                        {ROLES.map((r) => (
                            <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                                as {r}
                            </option>
                        ))}
                    </select>
                    <Button
                        size="sm"
                        className="h-9 sm:h-7"
                        loading={busy === u.id}
                        aria-label={`Approve ${u.email}`}
                        onClick={() => void approve(u)}
                    >
                        Approve
                    </Button>
                </>
            )}
            {!isMe && u.role !== "pending" && (
                <Button
                    size="sm"
                    variant="secondary"
                    className="h-9 sm:h-7"
                    disabled={busy === u.id}
                    aria-label={`Remove ${u.email}'s role`}
                    title="Send back to pending. They keep their account but lose all access until re-approved."
                    onClick={() => void removeRole(u)}
                >
                    Remove role
                </Button>
            )}
            {!isMe && (
                <Button
                    size="sm"
                    variant={u.active ? "destructive" : "secondary"}
                    className="h-9 sm:h-7"
                    disabled={busy === u.id}
                    aria-label={`${u.active ? "Block sign-in for" : "Allow sign-in for"} ${u.email}`}
                    title={u.active ? "Stop them signing in. Their role is kept." : "Let them sign in again with the role they had."}
                    onClick={() => void toggleActive(u)}
                >
                    {u.active ? "Block sign-in" : "Allow sign-in"}
                </Button>
            )}
        </>
    );

    const rowCheckbox = (u: AdminUser) => (
        <HitArea>
            <Checkbox
                checked={selection.isSelected(String(u.id))}
                onChange={(e) => selection.toggle(String(u.id), { shiftKey: e.shiftKey })}
                label={`Select ${u.email}`}
            />
        </HitArea>
    );

    const nameBlock = (u: AdminUser, isMe: boolean) => {
        const label = nameOf(u);
        return (
            <div className="min-w-0">
                <div className="truncate font-medium text-primary" title={label}>
                    {label}
                    {isMe && <span className="ml-1.5 text-xs text-muted">(you)</span>}
                </div>
                {label !== u.email && (
                    <div className="truncate text-xs text-muted" title={u.email}>
                        {u.email}
                    </div>
                )}
            </div>
        );
    };

    const providers = (u: AdminUser) => (u.providers.length ? u.providers.join(", ") : "—");

    const emptyState = (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <FontAwesomeIcon
                icon={filter === "pending" && !query ? faCircleCheck : faUsers}
                className={cn("text-2xl", filter === "pending" && !query ? "text-healthy" : "text-dimmed")}
                aria-hidden
            />
            <p className="text-sm font-medium text-secondary">
                {query ? `No ${filter === "all" ? "users" : FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} match “${query}”.` : EMPTY_COPY[filter]}
            </p>
            {filter === "pending" && !query && (
                <p className="text-xs text-muted">New SSO sign-ins land here for approval.</p>
            )}
            <div className="mt-1 flex gap-2">
                {query && (
                    <Button size="sm" variant="secondary" className="h-9 sm:h-7" onClick={() => setQ("")}>
                        Clear search
                    </Button>
                )}
                {filter !== "all" && (
                    <Button size="sm" variant="secondary" className="h-9 sm:h-7" onClick={() => setFilter("all")}>
                        Show all users
                    </Button>
                )}
            </div>
        </div>
    );

    const changeFilter = (next: Filter) => {
        selection.clear();
        setFilter(next);
    };

    return (
        <div>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-primary">Users</h1>
                    <p className="text-sm text-muted mt-1">
                        Approve accounts created by SSO sign-in, change roles, and block sign-in.
                        {pendingCount > 0 && ` ${pendingCount} waiting for approval.`}
                    </p>
                    <RoleHelp className="mt-1 -ml-1" />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-2">
                        {FILTERS.map((f) => {
                            const n = f.value === "all" ? allCount : counts?.[f.value];
                            const warn = f.value === "pending" && (n ?? 0) > 0;
                            return (
                                <Button
                                    key={f.value}
                                    size="sm"
                                    className="h-9 sm:h-7 gap-1.5"
                                    aria-pressed={filter === f.value}
                                    variant={filter === f.value ? "primary" : warn ? "warning" : "secondary"}
                                    onClick={() => changeFilter(f.value)}
                                >
                                    {f.label}
                                    {n != null && <span className="tabular-nums opacity-70">{n}</span>}
                                </Button>
                            );
                        })}
                    </div>
                    <div className="relative ml-auto w-full sm:w-64">
                        <Input
                            id="user-search"
                            aria-label="Search users"
                            placeholder="Search email or name…"
                            value={q}
                            onChange={(e) => {
                                selection.clear();
                                setQ(e.target.value);
                            }}
                            className="pr-9"
                        />
                        {stale ? (
                            <ButtonSpinner className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                        ) : (
                            <FontAwesomeIcon
                                icon={faMagnifyingGlass}
                                className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
                                aria-hidden
                            />
                        )}
                        {stale && <span className="sr-only" role="status">Searching…</span>}
                    </div>
                </div>

                {firstLoad ? (
                    <UsersListSkeleton />
                ) : listError && users.length === 0 ? (
                    <FailureState what="users" message={listError} onRetry={refresh} />
                ) : (
                    <>
                        {listError && (
                            <FailureNote
                                what="the latest list — the rows below may be out of date"
                                message={listError}
                                onRetry={refresh}
                            />
                        )}
                        <div className={cn("transition-opacity", stale && "opacity-60")} aria-busy={stale}>
                            {/* lg and up: a fixed-layout table, so columns hold still across filters. */}
                            <div className="hidden lg:block rounded-xl border border-border-strong">
                                <table className="w-full table-fixed text-sm">
                                    <colgroup>
                                        <col className="w-12" />
                                        <col />
                                        <col className="w-32" />
                                        <col className="w-40" />
                                        <col className="w-36" />
                                        <col className="w-64" />
                                    </colgroup>
                                    <thead className="border-b border-border-strong text-left text-xs uppercase tracking-wider text-secondary">
                                        <tr>
                                            <th className="px-4 py-3">
                                                <HitArea>
                                                    <Checkbox
                                                        checked={selection.allSelected}
                                                        indeterminate={selection.someSelected}
                                                        onChange={selection.toggleAll}
                                                        disabled={selectableIds.length === 0}
                                                        label="Select all users shown"
                                                    />
                                                </HitArea>
                                            </th>
                                            <th className="px-4 py-3 font-medium">User</th>
                                            <th className="px-4 py-3 font-medium">Sign-in</th>
                                            <th className="px-4 py-2 font-medium">
                                                <span className="inline-flex items-center gap-1">
                                                    Role <RoleHelp compact />
                                                </span>
                                            </th>
                                            <th className="px-4 py-3 font-medium">Status</th>
                                            <th className="px-4 py-3 font-medium text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-strong">
                                        {users.length === 0 ? (
                                            <tr>
                                                <td colSpan={6}>{emptyState}</td>
                                            </tr>
                                        ) : (
                                            users.map((u) => {
                                                const isMe = u.id === user?.id;
                                                return (
                                                    <tr
                                                        key={u.id}
                                                        className={cn(
                                                            "transition-colors duration-700",
                                                            flash === u.id && "bg-accent/10",
                                                        )}
                                                    >
                                                        <td className="px-4 py-3">{!isMe && rowCheckbox(u)}</td>
                                                        <td className="px-4 py-3">{nameBlock(u, isMe)}</td>
                                                        <td className="px-4 py-3 text-secondary break-words">{providers(u)}</td>
                                                        <td className="px-4 py-3">{roleCell(u, isMe)}</td>
                                                        <td className="px-4 py-3">{statusCell(u)}</td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex justify-end gap-2">{actions(u, isMe)}</div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Below lg: one card per user, so role, status and actions are never scrolled away. */}
                            <div className="lg:hidden rounded-xl border border-border-strong">
                                {selectableIds.length > 0 && (
                                    <div className="flex items-center gap-3 border-b border-border-strong px-4 py-2 text-xs text-secondary">
                                        <HitArea>
                                            <Checkbox
                                                checked={selection.allSelected}
                                                indeterminate={selection.someSelected}
                                                onChange={selection.toggleAll}
                                                label="Select all users shown"
                                            />
                                        </HitArea>
                                        Select all
                                    </div>
                                )}
                                {users.length === 0 ? (
                                    emptyState
                                ) : (
                                    <ul className="divide-y divide-border-strong">
                                        {users.map((u) => {
                                            const isMe = u.id === user?.id;
                                            return (
                                                <li
                                                    key={u.id}
                                                    className={cn(
                                                        "flex gap-3 px-4 py-3 transition-colors duration-700",
                                                        flash === u.id && "bg-accent/10",
                                                    )}
                                                >
                                                    <div className="w-8 shrink-0 pt-0.5">{!isMe && rowCheckbox(u)}</div>
                                                    <div className="min-w-0 flex-1 space-y-2 text-sm">
                                                        {nameBlock(u, isMe)}
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                                            {roleCell(u, isMe)}
                                                            {statusCell(u)}
                                                            <span className="text-xs text-muted">via {providers(u)}</span>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 empty:hidden">{actions(u, isMe)}</div>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </>
                )}

                <BulkActionBar count={selection.count} noun="user" onClear={selection.clear}>
                    {selectedPending.length > 0 && (
                        <select
                            aria-label="Approve selected pending accounts as"
                            value=""
                            disabled={bulkBusy}
                            onChange={(e) => e.target.value && void bulkApprove(e.target.value as UserRole)}
                            className={selectClass}
                        >
                            <option value="">Approve {selectedPending.length} as…</option>
                            {ROLES.map((r) => (
                                <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                                    {r}
                                </option>
                            ))}
                        </select>
                    )}
                    {selectedUsers.length > selectedPending.length && (
                        <select
                            aria-label="Set role on selected users"
                            value=""
                            disabled={bulkBusy}
                            onChange={(e) => e.target.value && void bulkSetRole(e.target.value as UserRole)}
                            className={selectClass}
                        >
                            <option value="">Set role…</option>
                            {ROLES.map((r) => {
                                // Options that would change nobody are disabled, never silent no-ops.
                                const n = setRoleTargets(r).length;
                                return (
                                    <option key={r} value={r} disabled={n === 0} title={ROLE_DESCRIPTIONS[r]}>
                                        {r} ({n === 0 ? "already" : n})
                                    </option>
                                );
                            })}
                        </select>
                    )}
                    <Button
                        size="sm"
                        variant="secondary"
                        className="h-9 sm:h-7"
                        disabled={bulkBusy || toEnable.length === 0}
                        title={toEnable.length === 0 ? "Everyone selected can already sign in" : undefined}
                        onClick={() => void bulkSetActive(true)}
                    >
                        Allow sign-in{toEnable.length > 0 && ` (${toEnable.length})`}
                    </Button>
                    <Button
                        size="sm"
                        variant="destructive"
                        className="h-9 sm:h-7"
                        loading={bulkBusy}
                        disabled={toDisable.length === 0}
                        title={toDisable.length === 0 ? "Everyone selected is already blocked" : undefined}
                        onClick={() => void bulkSetActive(false)}
                    >
                        Block sign-in{toDisable.length > 0 && ` (${toDisable.length})`}
                    </Button>
                </BulkActionBar>
                <p className="text-xs text-muted">
                    {/* No count under a failure panel: "0 of 0" would restate it as empty. */}
                    {!firstLoad && !(listError && users.length === 0) && `Showing ${users.length} of ${total}. `}
                    Changes take effect at once here; a zone honours an already-issued session for up to 15 minutes.
                </p>
            </div>
        </div>
    );
}
