import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Plain static files in out/, served by Cloudflare Workers (wrangler.jsonc, deploy/README.md).
  output: "export",
};

export default config;
