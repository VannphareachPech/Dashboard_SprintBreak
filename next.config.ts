import type { NextConfig } from "next";

// Basic hardening headers. Full CSP is deliberately not set here — it needs
// end-to-end testing (Recharts inline styles, Next.js runtime, etc.) before
// being safe to enable. These headers are safe defaults.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Apps Script endpoint lives on a different origin — allow server-side fetch
  // No client-side env vars needed; URL is kept server-side only
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
