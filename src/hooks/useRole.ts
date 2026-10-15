"use client";

import { useAuth } from "@/store/hooks";

/**
 * The signed-in user's verbs.
 *
 * monitor-core refuses every /v1 write from a session whose role is not
 * `admin` or `editor` (403, error_code 4003 — which `fetchApi` turns into a
 * redirect to /unauthorized). Rendering a Delete button a viewer can only be
 * bounced off is a trap, so write controls are hidden behind `canWrite`.
 *
 * This is presentation, not enforcement: the server is the boundary. While the
 * user is still loading, both are false — the controls appear a beat late
 * rather than flash and vanish.
 */
export function useRole() {
  const { user } = useAuth();
  const role = user?.role;
  return {
    role,
    canWrite: role === "admin" || role === "editor",
    isAdmin: role === "admin",
  };
}
