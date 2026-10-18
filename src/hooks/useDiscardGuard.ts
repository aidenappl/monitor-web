"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/ConfirmProvider";

/**
 * Wraps a dialog's `onClose` so a DIRTY form asks "Discard changes?" first.
 *
 * Pass the returned function to the Modal's `onClose` AND the footer's Cancel —
 * Escape, the backdrop and Cancel are the three ways out, and each used to throw
 * typed input away silently. A clean form closes immediately: a confirm on an
 * untouched dialog is noise, and noise is how people learn to click through.
 *
 * Callers compute `dirty` against what the form OPENED with (the edited record,
 * or the create defaults), not against empty.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void): () => Promise<void> {
    const confirm = useConfirm();
    return useCallback(async () => {
        if (
            dirty &&
            !(await confirm({
                title: "Discard changes?",
                description: "What you entered in this form has not been saved and will be lost.",
                confirmLabel: "Discard",
                destructive: true,
            }))
        )
            return;
        onClose();
    }, [dirty, onClose, confirm]);
}
