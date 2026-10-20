import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ngrok tunnels may load dev resources (phone testing over HTTPS).
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app"],
  // The dev badge sits over the bottom tab bar; compile and runtime errors still show without it.
  devIndicators: false,
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
