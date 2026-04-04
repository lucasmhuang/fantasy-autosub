import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@injurysub/config", "@injurysub/domain", "@injurysub/ui"],
};

export default nextConfig;
