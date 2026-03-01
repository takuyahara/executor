import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDir = dirname(fileURLToPath(import.meta.url));

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const publicControlPlaneBaseUrl =
  trim(process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL)
  ?? trim(process.env.CONTROL_PLANE_SERVER_BASE_URL)
  ?? trim(process.env.CONTROL_PLANE_UPSTREAM_URL)
  ?? trim(process.env.NEXT_PUBLIC_CONVEX_URL)
  ?? trim(process.env.CONVEX_URL)
  ?? "";

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(appDir, "../.."),
  env: {
    NEXT_PUBLIC_CONTROL_PLANE_BASE_URL: publicControlPlaneBaseUrl,
  },
};

export default nextConfig;
