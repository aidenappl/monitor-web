// Importing the service creates the browser Monitor before the app hydrates, so
// an error thrown during hydration is captured too.
//
// ⚠️ Deliberately NO page-load or navigation events (unlike keyring-web). This
// app reports its failures only — a pageview stream would bury them. See
// AGENTS.md §6 "Monitor self-telemetry".
import "@/services/monitor.service";

// Font Awesome's stylesheet is imported once in the root layout. The layout is a
// server module, so its `autoAddCss = false` never reaches the browser bundle;
// without this the client injects a second copy at runtime, after first paint.
import { config as faConfig } from "@fortawesome/fontawesome-svg-core";
faConfig.autoAddCss = false;
