import type { NextConfig } from "next";

// Silence baseline-browser-mapping "old data" warnings during Next.js build/dev.
// This warning is time-based and can break log-sensitive CI / reproducible builds.
process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= "1";

const nextConfig: NextConfig = {
  turbopack: {
    // Avoid Next.js selecting the wrong workspace root when multiple lockfiles exist.
    root: __dirname,
  },
};

export default nextConfig;
