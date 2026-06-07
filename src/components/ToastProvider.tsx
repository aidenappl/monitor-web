"use client";

import { Toaster } from "react-hot-toast";

export function ToastProvider() {
    return (
        <Toaster
            position="bottom-right"
            toastOptions={{
                style: {
                    background: "var(--background)",
                    color: "var(--foreground)",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                    fontSize: "13px",
                },
                success: {
                    iconTheme: { primary: "#22c55e", secondary: "var(--background)" },
                },
                error: {
                    iconTheme: { primary: "#ef4444", secondary: "var(--background)" },
                },
            }}
        />
    );
}
