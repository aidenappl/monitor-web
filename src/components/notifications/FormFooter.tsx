"use client";

import { Button } from "@/components/ui/button";

interface FormFooterProps {
    /** Create forms say "Create", edit forms say "Save" — the same on all three dialogs. */
    isEdit: boolean;
    submitting: boolean;
    disabled?: boolean;
    onCancel: () => void;
}

/**
 * The submit/cancel row for the notification dialogs, pinned to the bottom of
 * the modal's scroll area.
 *
 * ⚠️ STICKY ON PURPOSE. The policy dialog is taller than a 1280×800 viewport,
 * and with the buttons in the flow they sat below the fold — the dialog looked
 * like it had no way to save. The negative margins cancel the modal panel's
 * padding so the bar spans the panel and covers content scrolling under it.
 */
export function FormFooter({ isEdit, submitting, disabled, onCancel }: FormFooterProps) {
    return (
        <div className="sticky -bottom-5 sm:-bottom-6 -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-2 flex items-center justify-end gap-2 border-t border-border bg-surface px-5 sm:px-6 py-3">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
                Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={disabled}>
                {isEdit ? "Save" : "Create"}
            </Button>
        </div>
    );
}
