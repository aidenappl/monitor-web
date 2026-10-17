"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faXmark,
    faTrash,
    faToggleOn,
    faToggleOff,
    faFlask,
    faPen,
    faCopy,
    faEllipsisVertical,
    faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { PRIORITY_COLORS } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { useNow } from "./useNow";
import {
    AlertRuleRow,
    CONDITION_LABELS,
    RoutingPreview,
    channelTypeLabel,
    describeFilter,
    formatAgo,
    formatDuration,
    parseFilters,
    urgentWithoutPaging,
} from "./alerts.tools";

export type TestOutcome = { pending: true } | { error: string } | { value: number; would_fire: boolean };

function statusBadgeClass(status: string): string {
    switch (status) {
        case "ok":
            return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
        case "firing":
            return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
        case "resolved":
            return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
        default:
            return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    }
}
export { statusBadgeClass };

function typeBadgeClass(type: string): string {
    switch (type) {
        case "threshold":
            return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
        case "absence":
            return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
        case "rate_change":
            return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
        default:
            return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    }
}

interface RuleRowProps {
    rule: AlertRuleRow;
    /**
     * Null when the routing inputs failed to load: the line says "unknown",
     * never "nobody". Undefined while they are still loading: no line at all.
     */
    routing: RoutingPreview | null | undefined;
    test?: TestOutcome;
    onDismissTest: () => void;
    canWrite: boolean;
    selected: boolean;
    onSelect: (e: React.MouseEvent<HTMLInputElement>) => void;
    /** A toggle or duplicate is in flight for this row; its write actions are held. */
    busy: boolean;
    onTest: () => void;
    onToggle: () => void;
    onDuplicate: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

/**
 * One rule. Disabled rows are NOT faded: `opacity-60` on the whole block took
 * the already-light badges to 2.6:1. The "disabled" badge and a muted name say
 * it at full contrast instead.
 */
export function RuleRow({
    rule,
    routing,
    test,
    onDismissTest,
    canWrite,
    selected,
    onSelect,
    busy,
    onTest,
    onToggle,
    onDuplicate,
    onEdit,
    onDelete,
}: RuleRowProps) {
    const filters = parseFilters(rule.query_filters);
    const state = rule.state;
    const firing = rule.enabled && state?.status === "firing";

    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 transition-colors ${
                selected ? "bg-blue-50/60 dark:bg-blue-900/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            } ${firing ? "border-l-2 border-l-red-500" : ""}`}
        >
            {canWrite && (
                <Checkbox
                    checked={selected}
                    onChange={onSelect}
                    label={`Select ${rule.name}`}
                    className="mt-0.5"
                />
            )}
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                    <span
                        className={`min-w-0 max-w-full text-sm font-medium [overflow-wrap:anywhere] ${
                            rule.enabled ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"
                        }`}
                    >
                        {rule.name}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(rule.type)}`}>
                        {rule.type.replace("_", " ")}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[rule.priority || "P2"]}`}>
                        {rule.priority || "P2"}
                    </span>
                    {rule.enabled ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(state?.status || "ok")}`}>
                            {state?.status || "ok"}
                        </span>
                    ) : (
                        // A disabled rule's last state is history, not news:
                        // "ok" beside "disabled" read as healthy.
                        <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600">
                            disabled
                        </span>
                    )}
                </div>

                {/* What defines the rule: the condition, the filters it reads, and its timing. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="min-w-0 max-w-full font-mono [overflow-wrap:anywhere]">{conditionText(rule)}</span>
                    {filters.map((f, i) => (
                        <span
                            key={i}
                            className="max-w-full truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            title={describeFilter(f)}
                        >
                            {describeFilter(f)}
                        </span>
                    ))}
                    <span>
                        every {formatDuration(rule.evaluation_interval_seconds || 60)}
                        {rule.for_seconds > 0 && ` · held ${formatDuration(rule.for_seconds)}`}
                        {` · re-notify ${formatDuration(rule.cooldown_seconds)}`}
                    </span>
                </div>

                {rule.enabled && state && <StateLine state={state} />}

                {rule.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400 [overflow-wrap:anywhere]" title={rule.description}>
                        {rule.description}
                    </p>
                )}

                <RoutingLine rule={rule} routing={routing} />

                {test && (
                    <div className="mt-1.5 inline-flex max-w-full items-center gap-2 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800" role="status">
                        {"pending" in test ? (
                            <span className="text-zinc-600 dark:text-zinc-400"><FontAwesomeIcon icon={faSpinner} className="mr-1 animate-spin" />Testing…</span>
                        ) : "error" in test ? (
                            <span className="text-red-600 dark:text-red-400">Test failed: {test.error}</span>
                        ) : (
                            <span className={test.would_fire ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-emerald-700 dark:text-emerald-400"}>
                                Current value {test.value.toLocaleString()} — {test.would_fire ? "would fire" : "would not fire"}
                            </span>
                        )}
                        <button
                            onClick={onDismissTest}
                            aria-label="Dismiss test result"
                            title="Dismiss test result"
                            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
                        >
                            <FontAwesomeIcon icon={faXmark} className="text-[10px]" />
                        </button>
                    </div>
                )}
            </div>

            {/* Desktop: every action inline. Below sm: the toggle stays, the rest
                fold into a menu — five 34px buttons left a 375px row ~90px of text. */}
            <div className="flex items-center gap-1 shrink-0">
                <div className="hidden sm:flex items-center gap-1">
                    <RuleAction label="Test rule now (dry run, sends nothing)" icon={faFlask} onClick={onTest} />
                </div>
                {canWrite && (
                    <RuleAction
                        label={rule.enabled ? "Disable rule" : "Enable rule"}
                        icon={busy ? faSpinner : rule.enabled ? faToggleOn : faToggleOff}
                        iconClass={`text-lg ${busy ? "animate-spin text-sm" : rule.enabled ? "text-emerald-600" : ""}`}
                        onClick={onToggle}
                        disabled={busy}
                    />
                )}
                {canWrite && (
                    <div className="hidden sm:flex items-center gap-1">
                        <RuleAction label="Duplicate rule" icon={faCopy} onClick={onDuplicate} disabled={busy} />
                        <RuleAction label="Edit rule" icon={faPen} onClick={onEdit} disabled={busy} />
                        <RuleAction label="Delete rule" icon={faTrash} destructive onClick={onDelete} disabled={busy} />
                    </div>
                )}
                <div className="sm:hidden">
                    <RowMenu
                        ruleName={rule.name}
                        items={[
                            { label: "Test now", onSelect: onTest },
                            ...(canWrite
                                ? [
                                      { label: "Duplicate", onSelect: onDuplicate, disabled: busy },
                                      { label: "Edit", onSelect: onEdit, disabled: busy },
                                      { label: "Delete", onSelect: onDelete, disabled: busy, destructive: true },
                                  ]
                                : []),
                        ]}
                    />
                </div>
            </div>
        </div>
    );
}

function conditionText(rule: AlertRuleRow): string {
    if (rule.type === "absence") return "no events";
    const metric = rule.metric + (rule.field && rule.metric !== "count" ? `(${rule.field})` : "");
    const op = CONDITION_LABELS[rule.condition] || rule.condition;
    return `${metric} ${op} ${rule.threshold}${rule.type === "rate_change" ? "%" : ""}`;
}

/**
 * The state the API already returns, said out loud: a bare "ok" hid a rule that
 * fired and resolved two minutes ago, which on call matters more than its
 * static definition.
 */
function StateLine({ state }: { state: NonNullable<AlertRuleRow["state"]> }) {
    const now = useNow();
    const parts: string[] = [];
    if (state.status === "firing" && state.fired_at) {
        parts.push(`firing for ${formatDuration((now - new Date(state.fired_at).getTime()) / 1000)}`);
        parts.push(`value ${state.value.toLocaleString()}`);
    } else if (state.fired_at) {
        let fired = `last fired ${formatAgo(state.fired_at, now)}`;
        if (state.resolved_at && new Date(state.resolved_at) >= new Date(state.fired_at)) {
            fired += ` (lasted ${formatDuration((new Date(state.resolved_at).getTime() - new Date(state.fired_at).getTime()) / 1000)})`;
        }
        parts.push(fired);
    } else {
        parts.push("never fired");
    }
    if (state.last_notified_at) parts.push(`notified ${formatAgo(state.last_notified_at, now)}`);
    const title = [
        state.fired_at && `Fired ${new Date(state.fired_at).toLocaleString()}`,
        state.resolved_at && `Resolved ${new Date(state.resolved_at).toLocaleString()}`,
        state.last_notified_at && `Last notified ${new Date(state.last_notified_at).toLocaleString()}`,
    ]
        .filter(Boolean)
        .join("\n");
    return (
        <p
            className={`mt-1 text-xs ${state.status === "firing" ? "font-medium text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}
            title={title || undefined}
        >
            {parts.join(" · ")}
        </p>
    );
}

function RoutingLine({ rule, routing }: { rule: AlertRuleRow; routing: RoutingPreview | null | undefined }) {
    if (routing === undefined) return null;
    if (!routing) {
        return <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Routing unknown — notification settings didn&apos;t load.</p>;
    }
    const types = [...new Set(routing.destinations.map((d) => channelTypeLabel(d.type)))];
    const viaNames = routing.viaRuleChannels ? ["this rule's channels"] : routing.steps.map((s) => s.policy.name);
    const urgent = urgentWithoutPaging(rule.priority, routing);
    return (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {routing.destinations.length === 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="text-[10px]" aria-hidden />
                    Notifies nobody
                </span>
            ) : (
                <>
                    <span className="text-zinc-600 dark:text-zinc-400">→ {types.join(", ")} via</span>
                    {viaNames.map((name) => (
                        <span key={name} className="inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            {name}
                        </span>
                    ))}
                </>
            )}
            {urgent && (
                <span
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    title={`A ${rule.priority} rule with no PagerDuty or Slack destination`}
                >
                    {types.join(" + ")} only
                </span>
            )}
            {routing.missing > 0 && (
                <span
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    title="A policy or this rule names a channel that was deleted; it is skipped"
                >
                    {routing.missing} channel{routing.missing === 1 ? "" : "s"} missing
                </span>
            )}
        </div>
    );
}

function RuleAction({
    label,
    icon,
    onClick,
    destructive,
    disabled,
    iconClass = "text-sm",
}: {
    label: string;
    icon: typeof faPen;
    onClick: () => void;
    destructive?: boolean;
    disabled?: boolean;
    iconClass?: string;
}) {
    // Icon-only, so the label is both the accessible name and the tooltip: a
    // flask and a pencil do not explain themselves.
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={`p-2 text-zinc-500 rounded-lg hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                destructive ? "hover:text-red-600 dark:hover:text-red-400" : "hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
        >
            <FontAwesomeIcon icon={icon} className={iconClass} />
        </button>
    );
}

interface MenuItem {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    destructive?: boolean;
}

/** The phone-width overflow menu: arrow keys, Escape, outside click. */
function RowMenu({ ruleName, items }: { ruleName: string; items: MenuItem[] }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        const id = requestAnimationFrame(() => itemRefs.current.find((el) => el && !el.disabled)?.focus());
        return () => {
            document.removeEventListener("mousedown", onDown);
            cancelAnimationFrame(id);
        };
    }, [open]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        const enabled = itemRefs.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled);
        const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            buttonRef.current?.focus();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            enabled[(i + 1) % enabled.length]?.focus();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            enabled[(i - 1 + enabled.length) % enabled.length]?.focus();
        }
    };

    return (
        <div ref={wrapRef} className="relative" onKeyDown={onKeyDown}>
            <button
                ref={buttonRef}
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`More actions for ${ruleName}`}
                title="More actions"
                className="p-2 text-zinc-500 rounded-lg hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
                <FontAwesomeIcon icon={faEllipsisVertical} className="text-sm" />
            </button>
            {open && (
                <div
                    role="menu"
                    aria-label={`Actions for ${ruleName}`}
                    className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                >
                    {items.map((item, idx) => (
                        <button
                            key={item.label}
                            ref={(el) => {
                                itemRefs.current[idx] = el;
                            }}
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                            className={`block w-full px-3 py-2 text-left text-sm disabled:opacity-50 hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800 ${
                                item.destructive ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
