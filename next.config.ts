import type { NextConfig } from "next";

// Build remote patterns array
const remotePatterns: Array<{ protocol: "http" | "https"; hostname: string }> = [
  {
    protocol: "https",
    hostname: "**.strapi.io",
  },
  {
    protocol: "http",
    hostname: "localhost",
  },
];

// Add Strapi URL from environment if available
if (process.env.NEXT_PUBLIC_STRAPI_URL) {
  const strapiUrl = process.env.NEXT_PUBLIC_STRAPI_URL;
  remotePatterns.push({
    protocol: strapiUrl.startsWith("https") ? "https" : "http",
    hostname: new URL(strapiUrl).hostname,
  });
}

const nextConfig: NextConfig = {
  output: "standalone",
  productionBrowserSourceMaps: true,
  images: {
    remotePatterns,
  },
};

export default nextConfig;
