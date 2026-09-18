import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't get confused by the root-level
  // package-lock.json in this monorepo.
  turbopack: {
    root: path.join(__dirname),
  },
  // Emit a self-contained server bundle for a small production Docker image.
  output: 'standalone',
};

export default nextConfig;
