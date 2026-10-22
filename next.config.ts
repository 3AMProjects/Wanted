import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Photos and proof videos are uploaded through server actions for now.
    // Vercel caps request bodies at 4.5 MB, so move to direct-to-storage
    // signed uploads before launch.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
