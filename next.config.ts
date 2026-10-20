import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phone on the LAN + ngrok tunnels may load dev resources.
  allowedDevOrigins: ["192.168.1.131", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app"],
  cacheComponents: true,
  partialPrefetching: true,
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
