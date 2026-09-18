import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't get confused by the root-level
  // package-lock.json in this monorepo.
  turbopack: {
    root: path.join(__dirname),
  },
  // Standalone output is for the Docker image; on Vercel (VERCEL=1) use the
  // native build — 'standalone' + Turbopack breaks Vercel's file tracing.
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
