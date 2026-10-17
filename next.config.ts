import type { NextConfig } from "next";

// Static export: client components only, no API routes, no secrets (PRD NF-R9).
const nextConfig: NextConfig = {
  output: "export",
  // Set for GitHub Pages (served under /aeroplanner). Empty on Vercel or locally.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
