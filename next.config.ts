import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The install-wide admin pages moved into the ecosystem settings hub. Page
  // routes only: the admin API is `/api/monitor/admin/*`, which this does not
  // match. Not permanent (307): a 308 is cached by browsers for good, and the
  // hub's shape may still move.
  async redirects() {
    return [{ source: "/admin/:path*", destination: "/settings/admin/:path*", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
