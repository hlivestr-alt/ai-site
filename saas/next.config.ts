import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.SAAS_NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  devIndicators: false,
  // Development logging must not emit temporary OAuth query values or provider fetch URLs.
  logging: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Content-Type-Options", value: "nosniff" }] }];
  },
};

export default nextConfig;
