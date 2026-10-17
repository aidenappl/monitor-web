"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCircleQuestion, faMinus } from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils";
import { ASSIGNABLE_ROLES, PERMISSIONS, ROLE_DESCRIPTIONS } from "./roles";

/**
 * "What can each role do?" — a disclosure popover holding the permission
 * matrix. `compact` renders an icon-only trigger for a table header.
 * Escape and an outside click close it; focus returns to the trigger.
 */
export function RoleHelp({ compact = false, className }: { compact?: boolean; className?: string }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <span ref={rootRef} className={cn("relative inline-flex", className)}>
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={compact ? "What can each role do?" : undefined}
                title="What can each role do?"
                onClick={() => setOpen((o) => !o)}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md text-secondary transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    compact ? "h-7 w-7 justify-center normal-case" : "min-h-8 px-1 text-xs",
                )}
            >
                <FontAwesomeIcon icon={faCircleQuestion} className="h-3.5 w-3.5" aria-hidden />
                {!compact && "What can each role do?"}
            </button>
            {open && (
                <div
                    id={panelId}
                    role="region"
                    aria-label="Role permissions"
                    className="absolute left-0 top-full z-50 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border-strong bg-surface p-3 text-left text-xs normal-case tracking-normal shadow-2xl"
                >
                    <dl className="space-y-1.5">
                        {ASSIGNABLE_ROLES.map((r) => (
                            <div key={r}>
                                <dt className="inline font-semibold text-primary capitalize">{r}: </dt>
                                <dd className="inline text-secondary">{ROLE_DESCRIPTIONS[r]}</dd>
                            </div>
                        ))}
                    </dl>
                    <table className="mt-3 w-full table-fixed border-t border-border-strong">
                        <thead>
                            <tr className="text-[11px] text-muted">
                                <th className="py-1.5 font-medium">
                                    <span className="sr-only">Permission</span>
                                </th>
                                {ASSIGNABLE_ROLES.map((r) => (
                                    <th key={r} className="w-14 py-1.5 text-center font-medium capitalize">
                                        {r}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {PERMISSIONS.map((p) => (
                                <tr key={p.label} className="border-t border-border-strong/60">
                                    <th scope="row" className="py-1.5 pr-2 font-normal text-secondary">
                                        {p.label}
                                    </th>
                                    {ASSIGNABLE_ROLES.map((r) => {
                                        const yes = p.roles.includes(r);
                                        return (
                                            <td key={r} className="text-center">
                                                <FontAwesomeIcon
                                                    icon={yes ? faCheck : faMinus}
                                                    className={yes ? "text-healthy" : "text-dimmed"}
                                                    aria-hidden
                                                />
                                                <span className="sr-only">{yes ? "Yes" : "No"}</span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-2 text-[11px] text-muted">
                        Roles gate what someone can do, not which projects they see: every approved account reads every
                        project. Pending accounts have no access at all.
                    </p>
                </div>
            )}
        </span>
    );
}
