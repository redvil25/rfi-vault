import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up and finds a stray
  // package-lock.json in the user's home directory and warns on every build.
  turbopack: {
    root: path.resolve(__dirname),
  },

  // Fail the production build on type errors. The demo depends on this repo
  // staying green — see CLAUDE.md §7. Next 16 no longer runs ESLint during
  // `next build`, so linting is enforced separately in CI.
  typescript: { ignoreBuildErrors: false },

  experimental: {
    // Server Actions cap request bodies at 1 MB by default, which silently
    // rejects most real RFI PDFs. The Storage bucket enforces the same 20 MB
    // ceiling, and the upload action validates size before doing any work.
    serverActions: { bodySizeLimit: '20mb' },
  },
};

export default nextConfig;
