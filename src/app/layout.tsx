import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import StoreProvider from "@/store/StoreProvider";
import { AuthProvider } from "@/context/AuthContext";
import { Navbar } from "@/components/Navbar";
import { ToastProvider } from "@/components/ToastProvider";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ZONE_COOKIE } from "@/tools/routing.tools";

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
  title: "Monitor - Events Dashboard",
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
  // Last-used zone, for the navbar's links on the zone-agnostic pages. Read here
  // rather than in the client Navbar so the server and client passes agree.
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
              <ConfirmProvider>
              <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
                {/* Navbar reads the ?project selector to carry it across
                    navigations, and useSearchParams needs a Suspense boundary
                    during static generation. */}
                {/* The fallback reserves the header's height. With `null`, the
                    navbar (a useSearchParams client bailout) arrived after
                    hydration and pushed every page down 56px — a 0.19 CLS on
                    each load. */}
                <Suspense fallback={navbarless ? null : <div className="h-14 border-b border-zinc-200 dark:border-zinc-800" aria-hidden />}>
                  <Navbar rememberedZone={rememberedZone} />
                </Suspense>
                {children}
                <ToastProvider />
              </div>
              </ConfirmProvider>
            </AuthProvider>
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
