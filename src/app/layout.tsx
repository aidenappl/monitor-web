import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { config as faConfig } from "@fortawesome/fontawesome-svg-core";
// Font Awesome's sizing rules (`.svg-inline--fa { height: 1em; … }`) shipped in
// the page's own stylesheet. Left to the library, they are injected by its
// runtime after hydration, so every server-rendered icon painted at the SVG's
// intrinsic size — ~600px wide — and the page shifted when the style landed.
// Unlayered, exactly as the runtime injected it, so it still wins over Tailwind's
// layered utilities the way it always has: no icon changes size after load.
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import StoreProvider from "@/store/StoreProvider";
import { AuthProvider } from "@/context/AuthContext";
import { Navbar } from "@/components/Navbar";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { RememberedZoneProvider } from "@/context/RememberedZoneContext";
import { ZONE_COOKIE } from "@/tools/routing.tools";

// The stylesheet above replaces the runtime injection; don't add a second copy.
faConfig.autoAddCss = false;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )mon-appearance=([^;]*)/);var t=m?m[1]:"system";var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export const metadata: Metadata = {
  // Every route segment sets its own title ("Issues · appleby"); the template
  // appends the product name. With one fixed title, every tab, history entry
  // and screen-reader page announcement read the same.
  title: { template: "%s · Monitor", default: "Monitor" },
  description: "Event monitoring and observability dashboard",
  icons: {
    icon: [
      { url: "/favicon/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon/favicon.ico",
    apple: { url: "/favicon/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/favicon/site.webmanifest",
  appleWebApp: {
    title: "Monitor",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const appearance = cookieStore.get("mon-appearance")?.value;
  // Last-used zone, for zone links on the zone-agnostic pages. Read here and
  // seeded into RememberedZoneProvider so the server and client passes agree.
  const rememberedZone = cookieStore.get(ZONE_COOKIE)?.value;
  // Apply dark class server-side only when explicitly "dark".
  // For "system" or missing cookie the client ThemeProvider reconciles on hydration.
  const isDark = appearance === "dark";
  // Set by proxy.ts. The Navbar returns null on these three, so its fallback
  // must not reserve space there.
  const pathname = (await headers()).get("x-mon-pathname") ?? "";
  const navbarless = ["/login", "/pending", "/unauthorized"].includes(pathname);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <head>
        {/* Resolve "system" before first paint so dark-OS users don't get a
            white frame while waiting for hydration. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider initialTheme={appearance}>
          <StoreProvider>
            <AuthProvider>
              <RememberedZoneProvider initial={rememberedZone}>
              <ConfirmProvider>
              <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
                {/* The first Tab stop on every page with a navbar: without it a
                    keyboard user walks the logo, scope switcher, every nav link,
                    the health pill, theme and avatar before reaching anything
                    the page is for. */}
                {!navbarless && (
                  <a
                    href="#content"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-blue-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
                  >
                    Skip to content
                  </a>
                )}
                {/* Navbar reads the ?project selector to carry it across
                    navigations, and useSearchParams needs a Suspense boundary
                    during static generation. */}
                {/* The fallback reserves the header's height. With `null`, the
                    navbar (a useSearchParams client bailout) arrived after
                    hydration and pushed every page down 56px — a 0.19 CLS on
                    each load. */}
                <Suspense fallback={navbarless ? null : <div className="h-14 border-b border-zinc-200 dark:border-zinc-800" aria-hidden />}>
                  <Navbar />
                </Suspense>
                {/* The skip link's target. A wrapper rather than an id on each
                    page's own <main>, so no page has to remember it; tabIndex
                    -1 lets it take focus without becoming a Tab stop. */}
                <div id="content" tabIndex={-1} className="outline-none">
                  {children}
                </div>
                <ToastProvider />
              </div>
              </ConfirmProvider>
              </RememberedZoneProvider>
            </AuthProvider>
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
