export async function register() {
    // Only run in the Node.js runtime (not in the Edge runtime or during
    // the client-side bundle). This executes once at server startup, before
    // any request handler runs, so process.env mutations are visible
    // everywhere in the server process.
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    // All three credentials must be present before we attempt a network call.
    // Checking only KEYRING_URL is insufficient — if the access key or secret
    // are missing the API returns an HTML login redirect, not JSON.
    const { KEYRING_URL, KEYRING_ACCESS_KEY_ID, KEYRING_SECRET_ACCESS_KEY } = process.env;
    if (!KEYRING_URL || !KEYRING_ACCESS_KEY_ID || !KEYRING_SECRET_ACCESS_KEY) return;

    try {
        const { injectEnv } = await import("@aidenappleby/keyring-js");
        await injectEnv();
    } catch (err) {
        console.error("keyring: failed to inject secrets:", err);
    }
}
