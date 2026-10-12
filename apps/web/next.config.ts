import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Shell values win; loadEnvFile never overrides, so the first file loaded takes precedence.
for (const envFile of [".env.local", ".env"]) {
  const envPath = resolve(repoRoot, envFile);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@injurysub/config", "@injurysub/domain", "@injurysub/ui"],
};

export default nextConfig;
