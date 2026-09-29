import type { Instrumentation } from "next";

export async function register() {
    // Only run in the Node.js runtime (not in the Edge runtime or during
    // the client-side bundle). This executes once at server startup, before
    // any request handler runs, so process.env mutations are visible
    // everywhere in the server process.
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    // Load secrets from Keyring if credentials are present.
    const { KEYRING_URL, KEYRING_ACCESS_KEY_ID, KEYRING_SECRET_ACCESS_KEY } = process.env;
    if (KEYRING_URL && KEYRING_ACCESS_KEY_ID && KEYRING_SECRET_ACCESS_KEY) {
        try {
            const { injectEnv } = await import("@aidenappleby/keyring-js");
            await injectEnv();
        } catch (err) {
            // Both channels, deliberately. Telemetry is configured from PLAIN
            // env (MON_TELEMETRY_*, never Keyring) precisely so this failure is
            // reportable — but if telemetry is unset or misconfigured too, the
            // container log is the last place this is written down.
            console.error("keyring: failed to inject secrets:", err);
            let keyringHost: string | undefined;
            try {
                keyringHost = new URL(KEYRING_URL).host;
            } catch {
                // An unparseable KEYRING_URL is itself the likely cause; the
                // error below names it, so the host is simply omitted.
            }
            const { serverError } = await import("@/lib/monitor-server");
            serverError("keyring.inject.failed", err, {
                keyring_host: keyringHost,
                reason: "Keyring secret injection threw at server boot",
                outcome: "running on plain env",
            });
        }
    }
}

// Server-side request errors nothing caught — rendering, route handlers, server
// actions — go to Monitor. Node only: the edge runtime has no use for the SDK's
// timers.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    const { reportServerError } = await import("@/lib/monitor-server");
    reportServerError(error, request, context);
};
